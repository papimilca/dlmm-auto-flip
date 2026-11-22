import { describe, expect, it } from "vitest";
import { updateSweepStreak, type SweepStreak } from "../../src/strategy/engine.js";

describe("updateSweepStreak (FR-10)", () => {
  it("first tick of a trigger is not confirmed when confirmations > 1", () => {
    const { streak, confirmed } = updateSweepStreak(null, { action: "EXECUTE_LEVEL", level: 1 }, 2);
    expect(confirmed).toBe(false);
    expect(streak).toEqual({ action: "EXECUTE_LEVEL", level: 1, count: 1 });
  });

  it("second consecutive tick confirms (confirmations = 2)", () => {
    const first = updateSweepStreak(null, { action: "EXECUTE_LEVEL", level: 1 }, 2);
    const second = updateSweepStreak(first.streak, { action: "EXECUTE_LEVEL", level: 1 }, 2);
    expect(second.confirmed).toBe(true);
    expect(second.streak?.count).toBe(2);
  });

  it("confirmed streak stays confirmed on further ticks", () => {
    const first = updateSweepStreak(null, { action: "REVERSE_LEVEL", level: 2 }, 2);
    const second = updateSweepStreak(first.streak, { action: "REVERSE_LEVEL", level: 2 }, 2);
    const third = updateSweepStreak(second.streak, { action: "REVERSE_LEVEL", level: 2 }, 2);
    expect(third.confirmed).toBe(true);
  });

  it("a null decision (price back above level) resets the streak (FR-10.2)", () => {
    const first = updateSweepStreak(null, { action: "EXECUTE_LEVEL", level: 1 }, 2);
    const reset = updateSweepStreak(first.streak, null, 2);
    expect(reset.streak).toBeNull();
    expect(reset.confirmed).toBe(false);
    // sweep: one tick in, one tick out, one tick in → must NOT be confirmed
    const afterSweep = updateSweepStreak(reset.streak, { action: "EXECUTE_LEVEL", level: 1 }, 2);
    expect(afterSweep.confirmed).toBe(false);
    expect(afterSweep.streak?.count).toBe(1);
  });

  it("different level restarts the streak (same action)", () => {
    const streak: SweepStreak = { action: "EXECUTE_LEVEL", level: 1, count: 3 };
    const next = updateSweepStreak(streak, { action: "EXECUTE_LEVEL", level: 2 }, 2);
    expect(next.confirmed).toBe(false);
    expect(next.streak).toEqual({ action: "EXECUTE_LEVEL", level: 2, count: 1 });
  });

  it("different action restarts the streak (same level)", () => {
    const streak: SweepStreak = { action: "EXECUTE_LEVEL", level: 1, count: 3 };
    const next = updateSweepStreak(streak, { action: "REVERSE_LEVEL", level: 1 }, 2);
    expect(next.confirmed).toBe(false);
    expect(next.streak?.count).toBe(1);
  });

  it("confirmations = 1 keeps legacy behavior (immediate execution)", () => {
    const { streak, confirmed } = updateSweepStreak(null, { action: "EXECUTE_LEVEL", level: 1 }, 1);
    expect(confirmed).toBe(true);
    expect(streak?.count).toBe(1);
  });

  it("confirmations = 3 requires three consecutive ticks", () => {
    const a = updateSweepStreak(null, { action: "EXECUTE_LEVEL", level: 4 }, 3);
    expect(a.confirmed).toBe(false);
    const b = updateSweepStreak(a.streak, { action: "EXECUTE_LEVEL", level: 4 }, 3);
    expect(b.confirmed).toBe(false);
    const c = updateSweepStreak(b.streak, { action: "EXECUTE_LEVEL", level: 4 }, 3);
    expect(c.confirmed).toBe(true);
  });
});
