import { describe, expect, it } from "vitest";
import {
  evaluateReverse,
  evaluateReverseByBin,
} from "../../src/strategy/engine.js";
import { decide, type StrategyParams } from "../../src/strategy/decide.js";
import { CycleStateMachine } from "../../src/strategy/cycle.js";
import { StateStore } from "../../src/state/persistence.js";
import type { PositionState } from "../../src/state/persistence.js";

function makeStore(lastLevel: number, executedLevels: number[], lastReversedLevel = 0): StateStore {
  const positions: Record<string, PositionState> = {
    pos: { upperBinId: 1000, upperBinPrice: "1", lastLevel, executedLevels, lock: false, lastReversedLevel },
  };
  return new StateStore("state.json", { activePositions: [], positions });
}

// binPct fixtures: lower=800, upper=1000, stepPct -20 → stepBins=40.
// Level thresholds: L1=960, L2=920, L3=880.
const PARAMS: StrategyParams = {
  stepPct: -20,
  maxSteps: 5,
  triggerMode: "binPct",
  reverseFlipEnabled: true,
};

const PARAMS_OFF: StrategyParams = { ...PARAMS, reverseFlipEnabled: false };

describe("evaluateReverseByBin (FR-9.1)", () => {
  it("returns null when no level executed (lastLevel 0)", () => {
    expect(evaluateReverseByBin(1000, 800, 1000, -20, 0)).toBeNull();
  });

  it("triggers when active bin is strictly above the last level's threshold", () => {
    // lastLevel=1 → threshold bin 960; active bin 961 > 960 → reverse
    expect(evaluateReverseByBin(961, 800, 1000, -20, 1)).toEqual({ level: 1, thresholdBinId: 960 });
  });

  it("returns null when active bin is exactly at the threshold (no strict recovery)", () => {
    expect(evaluateReverseByBin(960, 800, 1000, -20, 1)).toBeNull();
  });

  it("returns null when active bin is below the threshold", () => {
    expect(evaluateReverseByBin(950, 800, 1000, -20, 1)).toBeNull();
  });

  it("reverses the deepest executed level (lastLevel=3 → threshold 880)", () => {
    expect(evaluateReverseByBin(900, 800, 1000, -20, 3)).toEqual({ level: 3, thresholdBinId: 880 });
  });
});

describe("evaluateReverse (pricePct mode, FR-9.1)", () => {
  it("triggers when price recovered strictly above the level price", () => {
    // upper=1, step -20% → L1 price 0.8
    expect(evaluateReverse("0.81", "1", -20, 1)).toEqual({ level: 1, levelPrice: "0.8" });
  });

  it("returns null at exactly the level price", () => {
    expect(evaluateReverse("0.8", "1", -20, 1)).toBeNull();
  });

  it("returns null when lastLevel is 0", () => {
    expect(evaluateReverse("1.5", "1", -20, 0)).toBeNull();
  });
});

describe("decide() reverse flip branch (FR-9)", () => {
  it("returns REVERSE_LEVEL when recovered above the last level and not yet reversed", () => {
    const sm = new CycleStateMachine(makeStore(1, [1]), "pos");
    const d = decide("0.9", "1", 961, 800, 1000, PARAMS, sm);
    expect(d.action).toBe("REVERSE_LEVEL");
    expect(d.level).toBe(1);
    expect(d.thresholdBinId).toBe(960);
    // quote-side range: lowerBin..min(activeBin, upperBin)
    expect(d.minBinId).toBe(800);
    expect(d.maxBinId).toBe(961);
  });

  it("does NOT reverse the same level twice (FR-9.5 guard)", () => {
    const sm = new CycleStateMachine(makeStore(1, [1], 1), "pos");
    expect(sm.lastReversedLevel).toBe(1);
    const d = decide("0.9", "1", 961, 800, 1000, PARAMS, sm);
    expect(d.action).toBe("MONITOR");
  });

  it("prefers EXECUTE_LEVEL over reverse (price dropped to next level)", () => {
    const sm = new CycleStateMachine(makeStore(1, [1]), "pos");
    // active bin 880 ≤ L2 threshold 920 → next level 2, not reverse
    const d = decide("0.5", "1", 880, 800, 1000, PARAMS, sm);
    expect(d.action).toBe("EXECUTE_LEVEL");
    expect(d.level).toBe(2);
  });

  it("returns MONITOR when reverseFlip disabled", () => {
    const sm = new CycleStateMachine(makeStore(1, [1]), "pos");
    const d = decide("0.9", "1", 961, 800, 1000, PARAMS_OFF, sm);
    expect(d.action).toBe("MONITOR");
  });

  it("pricePct mode: returns REVERSE_LEVEL with levelPrice", () => {
    const sm = new CycleStateMachine(makeStore(2, [1, 2]), "pos");
    const d = decide("0.7", "1", 900, 800, 1000, { ...PARAMS, triggerMode: "pricePct" }, sm);
    expect(d.action).toBe("REVERSE_LEVEL");
    expect(d.level).toBe(2);
    expect(d.levelPrice).toBe("0.6");
  });
});

describe("CycleStateMachine reverse bookkeeping (FR-9.4/FR-9.5)", () => {
  it("completeReverse rolls the level back and sets the reverse guard", () => {
    const store = makeStore(2, [1, 2]);
    const sm = new CycleStateMachine(store, "pos");
    sm.transition("TRIGGERED");
    sm.transition("WITHDRAWING");
    sm.transition("RE_ADDING");
    sm.completeReverse(2);
    expect(sm.lastLevel).toBe(1);
    expect(sm.executedLevels).toEqual([1]);
    expect(sm.lastReversedLevel).toBe(2);
    expect(sm.currentPhase).toBe("IDLE");
    // persisted
    expect(store.getPositionState("pos").lastReversedLevel).toBe(2);
  });

  it("completeReverse to 0 clamps lastLevel and empties executedLevels", () => {
    const sm = new CycleStateMachine(makeStore(1, [1]), "pos");
    sm.transition("TRIGGERED");
    sm.transition("WITHDRAWING");
    sm.transition("RE_ADDING");
    sm.completeReverse(1);
    expect(sm.lastLevel).toBe(0);
    expect(sm.executedLevels).toEqual([]);
  });

  it("clearReverseGuard re-arms reverse after the level re-triggers", () => {
    const sm = new CycleStateMachine(makeStore(1, [1], 1), "pos");
    sm.clearReverseGuard();
    expect(sm.lastReversedLevel).toBe(0);
    // now a recovery above the level threshold reverses again
    const d = decide("0.9", "1", 961, 800, 1000, PARAMS, sm);
    expect(d.action).toBe("REVERSE_LEVEL");
  });
});
