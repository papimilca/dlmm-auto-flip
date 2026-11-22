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
  // maxSteps alert tests only — reverse flip disabled to keep the scenario
  // isolated from the adaptive loop (reverse has its own tests). Sweep
  // validation off (legacy immediate execution) — sweep has its own tests.
  reverseFlip: { enabled: false, strategy: "bidask", hybridBidAskPct: 50 },
  sweepValidation: { confirmations: 1 },
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
          lastReversedLevel: 0,
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
      vi.fn(),
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
          lastReversedLevel: 0,
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

describe("FlipEngine sweep validation (FR-10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listWalletPositions.mockResolvedValue([walletPosition()]);
    mocks.getActiveBin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeEngine(confirmations: number, executor: LevelExecutor) {
    const dir = mkdtempSync(join(tmpdir(), "ba_flip_test_"));
    const store = new StateStore(join(dir, "state.json"), {
      activePositions: [],
      positions: {
        [POSITION]: {
          upperBinId: 1000,
          upperBinPrice: UPPER_BIN_PRICE,
          lastLevel: 0,
          executedLevels: [],
          lock: false,
          lastReversedLevel: 0,
        },
      },
    });
    const notifier = new TelegramNotifier();
    const engine = new FlipEngine(
      new Connection("http://localhost:8899"),
      new Keypair(),
      { ...config, sweepValidation: { confirmations } },
      store,
      notifier,
      executor,
      vi.fn(),
    );
    return { engine, store };
  }

  it("a momentary sweep (one tick below level, then back up) does NOT execute", async () => {
    const executor = vi.fn();
    const { engine } = makeEngine(2, executor);
    await engine.activate(POSITION);

    // tick 1: bin 960 ≤ L1 threshold 960 → pending (count 1, not confirmed)
    mocks.getActiveBin.mockResolvedValue({ binId: 960, pricePerToken: "0.000008" });
    await vi.advanceTimersByTimeAsync(600);
    expect(executor).not.toHaveBeenCalled();

    // tick 2: price wicks back up above the threshold → streak reset
    mocks.getActiveBin.mockResolvedValue({ binId: 990, pricePerToken: "0.0000099" });
    await vi.advanceTimersByTimeAsync(600);
    expect(executor).not.toHaveBeenCalled();

    // tick 3: dips again — still only count 1, not confirmed
    mocks.getActiveBin.mockResolvedValue({ binId: 960, pricePerToken: "0.000008" });
    await vi.advanceTimersByTimeAsync(600);
    expect(executor).not.toHaveBeenCalled();

    engine.stopAll();
  });

  it("a sustained move executes after N consecutive confirmations", async () => {
    const executor = vi.fn();
    const { engine, store } = makeEngine(3, executor);
    await engine.activate(POSITION);

    mocks.getActiveBin.mockResolvedValue({ binId: 960, pricePerToken: "0.000008" });
    await vi.advanceTimersByTimeAsync(600); // count 1
    expect(executor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600); // count 2
    expect(executor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600); // count 3 → confirmed
    expect(executor).toHaveBeenCalledTimes(1);
    expect(store.getPositionState(POSITION).lastLevel).toBe(1);

    engine.stopAll();
  });
});

describe("FlipEngine reverse flip (FR-9 adaptive loop)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listWalletPositions.mockResolvedValue([walletPosition()]);
    mocks.getActiveBin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("executes a level, then reverses it when the price recovers past its threshold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ba_flip_test_"));
    const store = new StateStore(join(dir, "state.json"), {
      activePositions: [],
      positions: {
        [POSITION]: {
          upperBinId: 1000,
          upperBinPrice: UPPER_BIN_PRICE,
          lastLevel: 0,
          executedLevels: [],
          lock: false,
          lastReversedLevel: 0,
        },
      },
    });
    const notifier = new TelegramNotifier();
    const executor: LevelExecutor = vi.fn();
    const reverseExecutor = vi.fn();
    const engine = new FlipEngine(
      new Connection("http://localhost:8899"),
      new Keypair(),
      { ...config, reverseFlip: { enabled: true, strategy: "bidask", hybridBidAskPct: 50 }, sweepValidation: { confirmations: 1 } },
      store,
      notifier,
      executor,
      reverseExecutor,
    );
    await engine.activate(POSITION);

    // Level 1 trigger: active bin 960 ≤ threshold 960.
    mocks.getActiveBin.mockResolvedValue({ binId: 960, pricePerToken: "0.000008" });
    await vi.advanceTimersByTimeAsync(600);
    expect(executor).toHaveBeenCalledTimes(1);

    // Recovery: active bin 970 > threshold 960 → reverse level 1.
    mocks.getActiveBin.mockResolvedValue({ binId: 970, pricePerToken: "0.000009" });
    await vi.advanceTimersByTimeAsync(600);
    expect(reverseExecutor).toHaveBeenCalledTimes(1);
    const revArg = (reverseExecutor as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(revArg.level).toBe(1);
    expect(revArg.minBinId).toBe(800);
    expect(revArg.maxBinId).toBe(970);
    // State rolled back: level 1 is triggerable again (FR-9.4).
    expect(store.getPositionState(POSITION).lastLevel).toBe(0);
    expect(store.getPositionState(POSITION).executedLevels).toEqual([]);
    expect(store.getPositionState(POSITION).lastReversedLevel).toBe(1);

    // Stay recovered: no second reverse for the same episode (FR-9.5).
    await vi.advanceTimersByTimeAsync(600);
    expect(reverseExecutor).toHaveBeenCalledTimes(1);

    // Drop again to level 1 → executor re-runs level 1 (adaptive loop).
    mocks.getActiveBin.mockResolvedValue({ binId: 960, pricePerToken: "0.000008" });
    await vi.advanceTimersByTimeAsync(600);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(store.getPositionState(POSITION).lastLevel).toBe(1);
    expect(store.getPositionState(POSITION).lastReversedLevel).toBe(0);

    engine.stopAll();
  });
});
