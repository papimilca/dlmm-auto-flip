import { describe, expect, it } from "vitest";
import {
  evaluateLevel,
  evaluateLevelByBin,
  levelBinId,
  levelPrice,
  stepBinCount,
} from "../../src/strategy/engine.ts";

const UPPER = "100";
const STEP = -20;
const MAX = 5;

describe("levelPrice (additive, FR-3.1)", () => {
  it("computes additive levels from upper bin", () => {
    expect(levelPrice(UPPER, STEP, 1)).toBe("80");
    expect(levelPrice(UPPER, STEP, 2)).toBe("60");
    expect(levelPrice(UPPER, STEP, 3)).toBe("40");
    expect(levelPrice(UPPER, STEP, 5)).toBe("0");
  });
});

describe("evaluateLevel (FR-3.2/FR-3.3)", () => {
  it("does not trigger above level 1 (-19.99%)", () => {
    expect(evaluateLevel("80.01", UPPER, STEP, MAX, 0)).toBeNull();
  });

  it("triggers exactly at level 1 (-20.00%)", () => {
    const r = evaluateLevel("80", UPPER, STEP, MAX, 0);
    expect(r?.level).toBe(1);
    expect(r?.levelPrice).toBe("80");
  });

  it("triggers below level 1 (-20.01%)", () => {
    expect(evaluateLevel("79.99", UPPER, STEP, MAX, 0)?.level).toBe(1);
  });

  it("price rising back never re-triggers executed level", () => {
    expect(evaluateLevel("95", UPPER, STEP, MAX, 1)).toBeNull();
  });

  it("skip: price crashes through several levels at once → next level is lastLevel+1", () => {
    const r = evaluateLevel("30", UPPER, STEP, MAX, 2);
    expect(r?.level).toBe(3);
  });

  it("noise: hovering at boundary does not double-fire (idempotent via lastLevel)", () => {
    expect(evaluateLevel("80", UPPER, STEP, MAX, 1)).toBeNull();
  });

  it("returns null when next level exceeds maxSteps (FR-6.2)", () => {
    expect(evaluateLevel("10", UPPER, STEP, 5, 5)).toBeNull();
  });
});

describe("stepBinCount / levelBinId (binPct, Q-11)", () => {
  it("60-bin position with -20% → stepBins = 12 (integer, exact)", () => {
    expect(stepBinCount(1100, 1160, -20)).toBe(12);
  });

  it("floors fractional step sizes (width 55, -20% → 11)", () => {
    expect(stepBinCount(100, 155, -20)).toBe(11);
  });

  it("clamps tiny ranges to at least 1 bin per step", () => {
    expect(stepBinCount(1099, 1100, -20)).toBe(1);
  });

  it("levels step down linearly from the upper bin (60-bin example)", () => {
    // 1100–1160: L1=1148, L2=1136, L3=1124, L4=1112, L5=1100 (lower bound)
    expect(levelBinId(1160, 12, 1)).toBe(1148);
    expect(levelBinId(1160, 12, 2)).toBe(1136);
    expect(levelBinId(1160, 12, 5)).toBe(1100);
  });
});

describe("evaluateLevelByBin (binPct, FR-3.2/FR-3.3 analog)", () => {
  const LOWER = 1100;
  const UPPER_BIN = 1160; // width 60, -20% → stepBins 12

  it("does not trigger above the threshold bin", () => {
    expect(evaluateLevelByBin(1149, LOWER, UPPER_BIN, STEP, MAX, 0)).toBeNull();
  });

  it("triggers exactly at the threshold bin", () => {
    const r = evaluateLevelByBin(1148, LOWER, UPPER_BIN, STEP, MAX, 0);
    expect(r?.level).toBe(1);
    expect(r?.thresholdBinId).toBe(1148);
  });

  it("triggers below the threshold bin", () => {
    expect(evaluateLevelByBin(1140, LOWER, UPPER_BIN, STEP, MAX, 0)?.level).toBe(1);
  });

  it("already-executed level never re-triggers (idempotent via lastLevel)", () => {
    expect(evaluateLevelByBin(1148, LOWER, UPPER_BIN, STEP, MAX, 1)).toBeNull();
    const r = evaluateLevelByBin(1120, LOWER, UPPER_BIN, STEP, MAX, 1);
    expect(r?.level).toBe(2); // next level, not skipped
    expect(r?.thresholdBinId).toBe(1136);
  });

  it("returns null when next level exceeds maxSteps (FR-6.2)", () => {
    expect(evaluateLevelByBin(1000, LOWER, UPPER_BIN, STEP, 5, 5)).toBeNull();
  });
});
