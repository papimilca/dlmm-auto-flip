import type { Connection, Keypair } from "@solana/web3.js";
import type { AppConfig } from "../config/schema.js";
import type { StateStore } from "../state/persistence.js";
import { CycleStateMachine } from "./cycle.js";
import { decide, type StrategyParams, type StrategyDecision } from "./decide.js";
import { loadPool } from "../dlmm/pool.js";
import { listWalletPositions, type WalletPosition } from "../dlmm/position.js";
import logger, { logAction } from "../logger/index.js";
import { TelegramNotifier } from "../notify/telegram.js";

/** Everything the executor needs to run one flip level. */
export interface LevelExecution {
  positionAddress: string;
  poolAddress: string;
  level: number;
  /** pricePct mode only; null in binPct mode. */
  levelPrice: string | null;
  /** binPct mode only; null in pricePct mode. */
  thresholdBinId: number | null;
  pctOfUpper: string | null;
  currentPrice: string;
  activeBinId: number;
  minBinId: number;
  maxBinId: number;
}

/**
 * Executes a triggered level. The dry-run executor only logs/notifies; the
 * live executor (withdraw + re-add, Fase 4) is wired when dryRun is false.
 */
export type LevelExecutor = (exec: LevelExecution) => Promise<void>;

interface Monitor {
  poolAddress: string;
  sm: CycleStateMachine;
  stopped: boolean;
  lowerBinId: number;
  upperBinId: number;
  /** maxSteps alert sent once per cycle; reset when a new cycle starts. */
  maxStepsAlerted: boolean;
}

/**
 * Multi-position flip engine (FR-2.2, FR-8.7, FR-8.8): one monitor loop per
 * active position, each with its own CycleStateMachine; pools are cached and
 * shared. Activate/deactivate is driven by the Telegram handlers.
 */
export class FlipEngine {
  private readonly monitors = new Map<string, Monitor>();
  private readonly pools = new Map<string, Awaited<ReturnType<typeof loadPool>>>();
  private readonly params: StrategyParams;

  constructor(
    private readonly connection: Connection,
    private readonly wallet: Keypair,
    private readonly config: AppConfig,
    private readonly store: StateStore,
    private readonly notifier: TelegramNotifier,
    private readonly executor: LevelExecutor,
  ) {
    this.params = {
      stepPct: config.stepPct,
      maxSteps: config.maxSteps,
      triggerMode: config.triggerMode,
    };
  }

  /** Fetch fresh wallet positions (FR-2.1, no cache). */
  listPositions(): Promise<WalletPosition[]> {
    return listWalletPositions(this.connection, this.wallet.publicKey);
  }

  isActive(positionAddress: string): boolean {
    return this.monitors.has(positionAddress);
  }

  activeCount(): number {
    return this.monitors.size;
  }

  /**
   * Activate flip for a position (button toggle, FR-8.4). Validates the
   * position still exists on chain, initializes the reference price
   * (upper bin, FR-2.3), persists, and starts the monitor loop.
   * Idempotent: activating an already-active position is a no-op (FR-8.8).
   */
  async activate(positionAddress: string): Promise<void> {
    if (this.monitors.has(positionAddress)) return;
    const positions = await this.listPositions();
    const found = positions.find((p) => p.positionAddress === positionAddress);
    if (!found) throw new Error(`Position not found in wallet: ${positionAddress}`);
    if (found.upperBinPrice === null) {
      throw new Error(`Position ${positionAddress} has no upper bin price (empty position?)`);
    }

    const sm = new CycleStateMachine(this.store, positionAddress);
    // Reference refresh: on first activate, or if the position's upper bin
    // changed on chain since the state was written (FR-2.3).
    const ps = this.store.getPositionState(positionAddress);
    if (ps.upperBinId !== found.upperBinId || ps.upperBinPrice === "0") {
      sm.setUpperBin(found.upperBinId, found.upperBinPrice);
    }

    this.store.setActive(positionAddress, true);
    const monitor: Monitor = {
      poolAddress: found.poolAddress,
      sm,
      stopped: false,
      lowerBinId: found.lowerBinId,
      upperBinId: found.upperBinId,
      maxStepsAlerted: false,
    };
    this.monitors.set(positionAddress, monitor);
    logAction("flipActivated", {
      positionAddress,
      poolAddress: found.poolAddress,
      upperBinPrice: sm.getUpperBinPrice(),
      lastLevel: sm.lastLevel,
    });
    void this.monitorLoop(positionAddress, monitor);
  }

  /** Deactivate flip for one position (FR-8.8, idempotent). */
  deactivate(positionAddress: string): boolean {
    const monitor = this.monitors.get(positionAddress);
    if (!monitor) return false;
    monitor.stopped = true;
    this.monitors.delete(positionAddress);
    this.store.setActive(positionAddress, false);
    logAction("flipDeactivated", { positionAddress });
    return true;
  }

  /** Deactivate everything (/stop, FR-8.5). Returns number stopped. */
  stopAll(): number {
    let n = 0;
    for (const address of [...this.monitors.keys()]) {
      this.deactivate(address);
      n++;
    }
    return n;
  }

  /** Status snapshot for /status (FR-8.6). */
  status(): Array<{
    positionAddress: string;
    poolAddress: string;
    lastLevel: number;
    executedLevels: readonly number[];
    phase: string;
    upperBinPrice: string;
  }> {
    return [...this.monitors.entries()].map(([address, m]) => ({
      positionAddress: address,
      poolAddress: m.poolAddress,
      lastLevel: m.sm.lastLevel,
      executedLevels: m.sm.executedLevels,
      phase: m.sm.currentPhase,
      upperBinPrice: m.sm.getUpperBinPrice(),
    }));
  }

  /** Restart recovery (FR-8.7): resume monitoring persisted active positions. */
  async resumePersisted(): Promise<number> {
    let resumed = 0;
    for (const address of this.store.activePositions) {
      try {
        await this.activate(address);
        resumed++;
      } catch (err: unknown) {
        // Position gone on chain or fetch failed — drop it from active list.
        logger.warn({ err: String(err), positionAddress: address }, "resumeFailed");
        this.store.setActive(address, false);
      }
    }
    return resumed;
  }

  private async getPool(poolAddress: string) {
    let pool = this.pools.get(poolAddress);
    if (!pool) {
      pool = await loadPool(this.connection, poolAddress);
      this.pools.set(poolAddress, pool);
    }
    return pool;
  }

  private async monitorLoop(positionAddress: string, monitor: Monitor): Promise<void> {
    while (!monitor.stopped) {
      await sleep(this.config.pollIntervalMs);
      if (monitor.stopped) return;
      try {
        await this.tick(positionAddress, monitor);
      } catch (err: unknown) {
        logger.error({ err: String(err), positionAddress }, "monitorTickFailed");
      }
    }
  }

  private async tick(positionAddress: string, monitor: Monitor): Promise<void> {
    const pool = await this.getPool(monitor.poolAddress);
    const activeBin = await pool.getActiveBin();
    const currentPrice = activeBin.pricePerToken;
    const upperBinPrice = monitor.sm.getUpperBinPrice();

    const decision: StrategyDecision = decide(
      currentPrice,
      upperBinPrice,
      activeBin.binId,
      monitor.lowerBinId,
      monitor.upperBinId,
      this.params,
      monitor.sm,
    );

    if (decision.action === "MONITOR") {
      // Price back above the maxSteps limit — allow a fresh alert if it dips again.
      monitor.maxStepsAlerted = false;
      return;
    }

    if (decision.action === "MAX_STEPS_EXCEEDED") {
      // Alert once per exceeded episode; the loop keeps ticking (FR-6.2).
      if (monitor.maxStepsAlerted) return;
      monitor.maxStepsAlerted = true;
      const limit =
        decision.thresholdBinId !== null
          ? `bin \`${decision.thresholdBinId}\``
          : `\`${decision.levelPrice}\``;
      this.notifier.send(
        `⚠️ *maxSteps exceeded*\nposition: \`${positionAddress}\`\nprice: \`${currentPrice}\` (below ${limit}) — monitoring only`,
      );
      return;
    }

    // EXECUTE_LEVEL — guarded by the state machine (FR-5.2).
    if (monitor.sm.currentPhase !== "IDLE") return;
    const exec: LevelExecution = {
      positionAddress,
      poolAddress: monitor.poolAddress,
      level: decision.level as number,
      levelPrice: decision.levelPrice,
      thresholdBinId: decision.thresholdBinId,
      pctOfUpper: decision.pctOfUpper,
      currentPrice,
      activeBinId: activeBin.binId,
      minBinId: decision.minBinId as number,
      maxBinId: decision.maxBinId as number,
    };
    const triggerDesc =
      exec.thresholdBinId !== null
        ? `bin \`${exec.activeBinId}\` ≤ \`${exec.thresholdBinId}\``
        : `\`${exec.levelPrice}\``;
    logAction("levelTriggered", {
      positionAddress,
      level: exec.level,
      levelPrice: exec.levelPrice,
      thresholdBinId: exec.thresholdBinId,
      triggerMode: this.params.triggerMode,
      currentPrice,
      pctOfUpper: exec.pctOfUpper,
      dryRun: this.config.dryRun,
    });
    this.notifier.send(
      `📉 *Level ${exec.level} reached*\nposition: \`${positionAddress}\`\ntrigger: ${triggerDesc}\nprice: \`${currentPrice}\` (\`${exec.pctOfUpper}%\` of upper bin)`,
    );

    monitor.sm.transition("TRIGGERED");
    try {
      monitor.sm.transition("WITHDRAWING");
      await this.executor(exec);
      monitor.sm.transition("RE_ADDING");
      monitor.sm.completeLevel(exec.level);
      logAction("levelCompleted", { positionAddress, level: exec.level });
    } catch (err: unknown) {
      logger.error({ err: String(err), positionAddress, level: exec.level }, "levelExecutionFailed");
      this.notifier.send(
        `❌ *Level ${exec.level} failed — flip STOPPED (FR-3.6)*\nposition: \`${positionAddress}\`\n\`${String(err)}\``,
      );
      monitor.sm.transition("IDLE"); // release lock; level not marked executed
      // Total failure stops the cycle for this position (FR-3.6): the level
      // is NOT marked executed, so re-activating will retry the same level.
      this.deactivate(positionAddress);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
