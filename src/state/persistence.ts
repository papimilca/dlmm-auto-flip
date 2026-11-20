import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** Cycle state for a single position (NFR-1: recovered on restart). */
export interface PositionState {
  /** Upper bin id of the position (reference price anchor, FR-2.3). */
  upperBinId: number;
  /** Price of the upper bin (decimal string, never float). */
  upperBinPrice: string;
  /** Highest step level executed so far. */
  lastLevel: number;
  /** All executed levels (idempotency guard, FR-3.3). */
  executedLevels: number[];
  /** True while a withdraw+re-add cycle is in flight (FR-5.2). */
  lock: boolean;
}

/**
 * Persisted state: strategy state keyed by position address, plus the set of
 * positions with active flip (FR-8.7). Atomic write (tmp + rename).
 */
export interface StateFile {
  /** Position addresses with active flip (user toggled via Telegram). */
  activePositions: string[];
  positions: Record<string, PositionState>;
}

function freshState(): StateFile {
  return { activePositions: [], positions: {} };
}

function isValid(v: unknown): v is StateFile {
  const s = v as StateFile;
  return (
    Array.isArray(s.activePositions) &&
    typeof s.positions === "object" &&
    s.positions !== null &&
    Object.values(s.positions).every(
      (p) =>
        typeof p.upperBinId === "number" &&
        typeof p.upperBinPrice === "string" &&
        typeof p.lastLevel === "number" &&
        Array.isArray(p.executedLevels),
    )
  );
}

export function loadStateFile(path: string): StateFile {
  if (!existsSync(path)) return freshState();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isValid(raw)) return freshState(); // corrupted — fresh start
    return { activePositions: [...raw.activePositions], positions: { ...raw.positions } };
  } catch {
    return freshState();
  }
}

/** Atomic write (tmp + rename) so a crash mid-write cannot corrupt state. */
export function saveStateFile(path: string, state: StateFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

// ---- In-memory multi-position store ---------------------------------------

/** Store keyed by position address with atomic persistence (FR-8.7, FR-8.8). */
export class StateStore {
  private state: StateFile;

  constructor(
    private readonly path: string,
    state?: StateFile,
  ) {
    this.state = state ?? loadStateFile(path);
  }

  get activePositions(): readonly string[] {
    return this.state.activePositions;
  }

  isActive(positionAddress: string): boolean {
    return this.state.activePositions.includes(positionAddress);
  }

  /** Toggle activate/deactivate; idempotent (FR-8.8). Returns new active flag. */
  setActive(positionAddress: string, active: boolean): boolean {
    const has = this.isActive(positionAddress);
    if (active && !has) this.state.activePositions.push(positionAddress);
    if (!active && has) {
      this.state.activePositions = this.state.activePositions.filter((p) => p !== positionAddress);
    }
    this.persist();
    return this.isActive(positionAddress);
  }

  /** Deactivate everything (/stop, FR-8.5). Level state is preserved. */
  deactivateAll(): number {
    const n = this.state.activePositions.length;
    this.state.activePositions = [];
    this.persist();
    return n;
  }

  getPositionState(positionAddress: string): PositionState {
    let s = this.state.positions[positionAddress];
    if (!s) {
      s = { upperBinId: 0, upperBinPrice: "0", lastLevel: 0, executedLevels: [], lock: false };
      this.state.positions[positionAddress] = s;
    }
    return s;
  }

  persist(): void {
    saveStateFile(this.path, this.state);
  }
}
