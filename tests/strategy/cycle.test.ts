import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CycleStateMachine } from "../../src/strategy/cycle.ts";
import { StateStore } from "../../src/state/persistence.ts";
import { decide, type StrategyParams } from "../../src/strategy/decide.ts";

// Unique dir per test (tests may run concurrently — no shared module state).
function newStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), "ba_flip-sm-")), "state.json");
}

function cleanup(path: string): void {
  rmSync(join(path, ".."), { recursive: true, force: true });
}

const params: StrategyParams = { stepPct: -20, maxSteps: 3, triggerMode: "pricePct" };
const binParams: StrategyParams = { stepPct: -20, maxSteps: 5, triggerMode: "binPct" };
const UPPER = "100";
const LOWER_BIN = 900;
const UPPER_BIN = 1100;
const POS = "Pos11111111111111111111111111111111111111111";
const OTHER = "Other1111111111111111111111111111111111111";

function newMachine(path: string, position = POS): CycleStateMachine {
  const sm = new CycleStateMachine(new StateStore(path), position);
  sm.setUpperBin(1234, UPPER);
  return sm;
}

function runFullLevel(machine: CycleStateMachine, level: number): void {
  machine.transition("TRIGGERED");
  machine.transition("WITHDRAWING");
  machine.transition("RE_ADDING");
  machine.completeLevel(level);
}

describe("CycleStateMachine", () => {
  it("follows the happy-path transitions", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    expect(sm.currentPhase).toBe("IDLE");
    expect(sm.lastLevel).toBe(1);
    expect(sm.executedLevels).toEqual([1]);
    cleanup(p);
  });

  it("rejects double execution (illegal transition)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    sm.transition("TRIGGERED");
    expect(() => sm.transition("TRIGGERED")).toThrow(/Illegal cycle transition/);
    expect(() => sm.transition("RE_ADDING")).toThrow(/Illegal cycle transition/);
    cleanup(p);
  });

  it("rejects re-add before withdraw started", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    expect(() => sm.transition("RE_ADDING")).toThrow(/Illegal cycle transition/);
    cleanup(p);
  });

  it("recovers after restart: phase resets to IDLE, executed levels persist", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    runFullLevel(sm, 2);
    const restarted = new CycleStateMachine(new StateStore(p), POS);
    expect(restarted.currentPhase).toBe("IDLE");
    expect(restarted.lastLevel).toBe(2);
    expect([...restarted.executedLevels]).toEqual([1, 2]);
    cleanup(p);
  });

  it("crash mid-cycle: lock persisted, cleared on restart", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    sm.transition("TRIGGERED"); // persists lock=true
    const restarted = new CycleStateMachine(new StateStore(p), POS);
    expect(restarted.currentPhase).toBe("IDLE");
    cleanup(p);
  });

  it("completeLevel keeps executedLevels unique (idempotent, FR-3.3)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    const sm2 = new CycleStateMachine(new StateStore(p), POS);
    runFullLevel(sm2, 1);
    expect([...sm2.executedLevels]).toEqual([1]);
    expect(sm2.lastLevel).toBe(1);
    cleanup(p);
  });

  it("state is isolated per position (multi-position, FR-2.2)", () => {
    const p = newStorePath();
    const store = new StateStore(p);
    const sm = new CycleStateMachine(store, POS);
    const other = new CycleStateMachine(store, OTHER);
    runFullLevel(sm, 1);
    expect(other.lastLevel).toBe(0);
    expect(other.executedLevels).toEqual([]);
    runFullLevel(other, 3);
    expect(sm.executedLevels).toEqual([1]);
    expect(other.executedLevels).toEqual([3]);
    cleanup(p);
  });
});

describe("decide", () => {
  it("MONITOR while price above next level", () => {
    const p = newStorePath();
    const d = decide("90", UPPER, 1000, LOWER_BIN, UPPER_BIN, params, newMachine(p));
    expect(d.action).toBe("MONITOR");
    cleanup(p);
  });

  it("EXECUTE_LEVEL at -20% with bid-ask range", () => {
    const p = newStorePath();
    const d = decide("80", UPPER, 1000, LOWER_BIN, UPPER_BIN, params, newMachine(p));
    expect(d.action).toBe("EXECUTE_LEVEL");
    expect(d.level).toBe(1);
    // Re-add target: base-side bins of the SAME position (FR-4.1a)
    expect(d.minBinId).toBe(1001); // activeBinId + 1
    expect(d.maxBinId).toBe(UPPER_BIN);
    cleanup(p);
  });

  it("MAX_STEPS_EXCEEDED when price below deepest level and all executed (FR-6.2)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    runFullLevel(sm, 2);
    runFullLevel(sm, 3);
    const d = decide("5", UPPER, 1000, LOWER_BIN, UPPER_BIN, params, sm);
    expect(d.action).toBe("MAX_STEPS_EXCEEDED");
    cleanup(p);
  });

  it("does not re-execute a completed level after restart (FR-3.3/AC-4)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    const restarted = new CycleStateMachine(new StateStore(p), POS);
    const d = decide("60", UPPER, 1000, LOWER_BIN, UPPER_BIN, params, restarted);
    expect(d.action).toBe("EXECUTE_LEVEL");
    expect(d.level).toBe(2); // level 1 not repeated
    cleanup(p);
  });

  it("EXECUTE_LEVEL with price crashed far below next level (multi-level skip)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    const d = decide("10", UPPER, 1000, LOWER_BIN, UPPER_BIN, params, sm);
    expect(d.action).toBe("EXECUTE_LEVEL");
    expect(d.level).toBe(2); // next level, not jumped to 3
    cleanup(p);
  });
});

describe("decide (binPct mode, Q-11)", () => {
  // Range 900–1100 (width 200), stepPct -20 → stepBins = 40.
  // Thresholds: L1=1060, L2=1020, L3=980, L4=940, L5=900.
  it("MONITOR while active bin above the next threshold", () => {
    const p = newStorePath();
    const d = decide("90", UPPER, 1061, LOWER_BIN, UPPER_BIN, binParams, newMachine(p));
    expect(d.action).toBe("MONITOR");
    cleanup(p);
  });

  it("EXECUTE_LEVEL when active bin hits the threshold exactly", () => {
    const p = newStorePath();
    const d = decide("90", UPPER, 1060, LOWER_BIN, UPPER_BIN, binParams, newMachine(p));
    expect(d.action).toBe("EXECUTE_LEVEL");
    expect(d.level).toBe(1);
    expect(d.thresholdBinId).toBe(1060);
    expect(d.levelPrice).toBeNull();
    expect(d.minBinId).toBe(1061); // activeBinId + 1 (base side of the same position)
    expect(d.maxBinId).toBe(UPPER_BIN);
    cleanup(p);
  });

  it("MONITOR just above threshold with a narrower range (step scaled to width)", () => {
    const p = newStorePath();
    // Narrow position 1080–1100 (width 20) → stepBins = 4 → L1 threshold = 1096.
    const d = decide("90", UPPER, 1097, 1080, UPPER_BIN, binParams, newMachine(p));
    expect(d.action).toBe("MONITOR");
    cleanup(p);
  });

  it("does not re-execute a completed level after restart (FR-3.3)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    runFullLevel(sm, 1);
    const restarted = new CycleStateMachine(new StateStore(p), POS);
    const d = decide("90", UPPER, 1000, LOWER_BIN, UPPER_BIN, binParams, restarted);
    expect(d.action).toBe("EXECUTE_LEVEL");
    expect(d.level).toBe(2);
    expect(d.thresholdBinId).toBe(1020);
    cleanup(p);
  });

  it("returns null beyond maxSteps → MAX_STEPS_EXCEEDED below deepest threshold (FR-6.2)", () => {
    const p = newStorePath();
    const sm = newMachine(p);
    for (let i = 1; i <= 5; i++) runFullLevel(sm, i);
    const d = decide("90", UPPER, 899, LOWER_BIN, UPPER_BIN, binParams, sm);
    expect(d.action).toBe("MAX_STEPS_EXCEEDED");
    expect(d.thresholdBinId).toBe(900);
    cleanup(p);
  });
});
