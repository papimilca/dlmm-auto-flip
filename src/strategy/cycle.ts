import { StateStore, type PositionState } from "../state/persistence.js";

export type CyclePhase = "IDLE" | "TRIGGERED" | "WITHDRAWING" | "RE_ADDING" | "DONE";

/**
 * Per-level cycle state machine for ONE position (FR-5.2, FR-3.3).
 * Guards double execution via an in-memory phase + persisted lock/lastLevel
 * in the shared multi-position StateStore.
 */
export class CycleStateMachine {
  private phase: CyclePhase = "IDLE";
  private readonly store: StateStore;
  private state: PositionState;

  constructor(store: StateStore, private readonly positionAddress: string) {
    this.store = store;
    this.state = store.getPositionState(positionAddress);
    // Crash recovery: a persisted lock means a cycle was in flight. The
    // safest restart behavior is to treat the cycle as not started —
    // withdraw stays idempotent per level via executedLevels.
    this.state.lock = false;
  }

  get currentPhase(): CyclePhase {
    return this.phase;
  }

  get lastLevel(): number {
    return this.state.lastLevel;
  }

  get executedLevels(): readonly number[] {
    return this.state.executedLevels;
  }

  /** FR-9.5: last level reversed by the adaptive loop (0 = none). */
  get lastReversedLevel(): number {
    return this.state.lastReversedLevel ?? 0;
  }

  getUpperBinPrice(): string {
    return this.state.upperBinPrice;
  }

  /** Advance phase; throws on illegal transition (double-execution guard). */
  transition(next: CyclePhase): void {
    const allowed: Record<CyclePhase, CyclePhase[]> = {
      IDLE: ["TRIGGERED"],
      TRIGGERED: ["WITHDRAWING", "IDLE"], // IDLE on withdraw failure/stop
      WITHDRAWING: ["RE_ADDING", "IDLE"], // IDLE on withdraw failure/stop
      RE_ADDING: ["DONE", "IDLE"], // IDLE on re-add failure/stop
      DONE: ["IDLE"],
    };
    if (!allowed[this.phase].includes(next)) {
      throw new Error(`Illegal cycle transition: ${this.phase} -> ${next}`);
    }
    this.phase = next;
    if (next === "TRIGGERED") this.setLock(true);
    if (next === "IDLE" || next === "DONE") this.setLock(false);
  }

  /** Mark level N as fully executed (idempotent persistence, FR-3.3). */
  completeLevel(level: number): void {
    if (!this.state.executedLevels.includes(level)) {
      this.state.executedLevels.push(level);
    }
    this.state.lastLevel = Math.max(this.state.lastLevel, level);
    this.transition("DONE");
    this.transition("IDLE");
  }

  /**
   * Complete a reverse flip (FR-9.4): roll the level back — the reversed
   * level is removed from executedLevels, lastLevel decremented (so the same
   * level can trigger again), and lastReversedLevel set as the idempotency
   * guard (FR-9.5) until the level re-triggers.
   */
  completeReverse(level: number): void {
    this.state.executedLevels = this.state.executedLevels.filter((l) => l !== level);
    this.state.lastLevel = Math.max(this.state.lastLevel - 1, 0);
    this.state.lastReversedLevel = level;
    this.store.persist();
    this.transition("DONE");
    this.transition("IDLE");
  }

  /** A level re-triggered after a reverse clears the reverse guard (FR-9.5). */
  clearReverseGuard(): void {
    if (this.state.lastReversedLevel !== 0) {
      this.state.lastReversedLevel = 0;
      this.store.persist();
    }
  }

  private setLock(lock: boolean): void {
    this.state.lock = lock;
    this.store.persist();
  }

  /** Initialize/update reference (upper bin of the position, FR-2.3). */
  setUpperBin(upperBinId: number, upperBinPrice: string): void {
    this.state.upperBinId = upperBinId;
    this.state.upperBinPrice = upperBinPrice;
    this.store.persist();
  }
}
