import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, Connection } from "@solana/web3.js";
import { FlipEngine, type LevelExecutor } from "../../src/strategy/monitor.js";
import { StateStore } from "../../src/state/persistence.js";
import { TelegramNotifier } from "../../src/notify/telegram.js";
import type { AppConfig } from "../../src/config/schema.js";
import type { WalletPosition } from "../../src/dlmm/position.js";

const mocks = vi.hoisted(() => ({
  getActiveBin: vi.fn(),
  listWalletPositions: vi.fn(),
}));

vi.mock("../../src/dlmm/pool.js", () => ({
  loadPool: vi.fn(async () => ({ getActiveBin: mocks.getActiveBin })),
}));

vi.mock("../../src/dlmm/position.js", () => ({
  listWalletPositions: mocks.listWalletPositions,
}));

const POSITION = "pos11111111111111111111111111111111111111111";
const POOL = Keypair.generate().publicKey.toString();

const config: AppConfig = {
  stepPct: -20,
  triggerMode: "binPct",
  maxSteps: 5,
  slippageBps: 100,
  dryRun: true,
  pollIntervalMs: 500,
  txMaxRetries: 3,
  telegramPollTimeoutSec: 30,
};

// binPct mode: stepBins = floor((1000-800)*20/100) = 40 → deepest = 1000-40*5 = 800
const BELOW_DEEPEST_BIN = 700;
const RECOVERED_BIN = 850;

const UPPER_BIN_PRICE = "0.00001";

function walletPosition(): WalletPosition {
  return {
    positionAddress: POSITION,
    poolAddress: POOL,
    tokenXSymbol: "X",
    tokenYSymbol: "Y",
    binStep: 10,
    lowerBinId: 800,
    upperBinId: 1000,
    upperBinPrice: UPPER_BIN_PRICE,
    totalXAmount: "1000000",
    totalYAmount: "0",
  };
}

describe("FlipEngine maxSteps alert (FR-6.2, alert once per episode)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listWalletPositions.mockResolvedValue([walletPosition()]);
    mocks.getActiveBin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends the maxSteps alert only once while price stays below the limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba_flip_test_"));
    const store = new StateStore(join(dir, "state.json"), {
      activePositions: [],
      positions: {
        [POSITION]: {
          upperBinId: 1000,
          upperBinPrice: UPPER_BIN_PRICE,
          lastLevel: 5,
          executedLevels: [1, 2, 3, 4, 5],
          lock: false,
        },
      },
    });
    const notifier = new TelegramNotifier();
    const sendSpy = vi.spyOn(notifier, "send");
    const executor: LevelExecutor = vi.fn();

    const engine = new FlipEngine(
      new Connection("http://localhost:8899"),
      new Keypair(),
      config,
      store,
      notifier,
      executor,
    );
    await engine.activate(POSITION);

    mocks.getActiveBin.mockResolvedValue({ binId: BELOW_DEEPEST_BIN, pricePerToken: "0.000001" });
    await vi.advanceTimersByTimeAsync(600); // tick 1
    await vi.advanceTimersByTimeAsync(600); // tick 2
    await vi.advanceTimersByTimeAsync(600); // tick 3

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]).toContain("maxSteps exceeded");

    engine.stopAll();
  });

  it("re-alerts once per episode: alert → recovery → dip again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba_flip_test_"));
    const store = new StateStore(join(dir, "state.json"), {
      activePositions: [],
      positions: {
        [POSITION]: {
          upperBinId: 1000,
          upperBinPrice: UPPER_BIN_PRICE,
          lastLevel: 5,
          executedLevels: [1, 2, 3, 4, 5],
          lock: false,
        },
      },
    });
    const notifier = new TelegramNotifier();
    const sendSpy = vi.spyOn(notifier, "send");
    const engine = new FlipEngine(
      new Connection("http://localhost:8899"),
      new Keypair(),
      config,
      store,
      notifier,
      vi.fn(),
    );
    await engine.activate(POSITION);

    // Episode 1: below limit → one alert.
    mocks.getActiveBin.mockResolvedValue({ binId: BELOW_DEEPEST_BIN, pricePerToken: "0.000001" });
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(600);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Recovery: MONITOR resets the flag (no alert expected).
    mocks.getActiveBin.mockResolvedValue({ binId: RECOVERED_BIN, pricePerToken: "0.000009" });
    await vi.advanceTimersByTimeAsync(600);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Episode 2: dips below again → one fresh alert.
    mocks.getActiveBin.mockResolvedValue({ binId: BELOW_DEEPEST_BIN, pricePerToken: "0.000001" });
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(600);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[0]).toContain("maxSteps exceeded");

    engine.stopAll();
  });
});
