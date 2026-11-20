import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadStateFile, saveStateFile, StateStore, type StateFile } from "../../src/state/persistence.ts";

// Unique dir per test (tests may run concurrently — no shared module state).
function newPath(): string {
  return join(mkdtempSync(join(tmpdir(), "ba_flip-")), "state.json");
}

function cleanup(path: string): void {
  rmSync(join(path, ".."), { recursive: true, force: true });
}

const state: StateFile = {
  activePositions: ["Pos11111111111111111111111111111111111111111"],
  positions: {
    Pos11111111111111111111111111111111111111111: {
      upperBinId: 1234,
      upperBinPrice: "1.5625",
      lastLevel: 2,
      executedLevels: [1, 2],
      lock: false,
    },
  },
};

describe("state file persistence", () => {
  it("returns empty state when file missing", () => {
    const p = newPath();
    expect(loadStateFile(p)).toEqual({ activePositions: [], positions: {} });
    cleanup(p);
  });

  it("save + load round-trips", () => {
    const p = newPath();
    saveStateFile(p, state);
    expect(loadStateFile(p)).toEqual(state);
    cleanup(p);
  });

  it("treats corrupted file as fresh start", () => {
    const p = newPath();
    writeFileSync(p, "{ not valid json");
    expect(loadStateFile(p)).toEqual({ activePositions: [], positions: {} });
    cleanup(p);
  });
});

describe("StateStore (multi-position)", () => {
  it("toggle activate/deactivate is idempotent (FR-8.8)", () => {
    const p = newPath();
    const store = new StateStore(p);
    expect(store.isActive("A")).toBe(false);
    expect(store.setActive("A", true)).toBe(true);
    expect(store.setActive("A", true)).toBe(true); // no duplicate entry
    expect(store.activePositions).toEqual(["A"]);
    expect(store.setActive("A", false)).toBe(false);
    expect(store.activePositions).toEqual([]);
    cleanup(p);
  });

  it("persists across restart (FR-8.7)", () => {
    const p = newPath();
    const store = new StateStore(p);
    store.setActive("A", true);
    store.setActive("B", true);
    const reopened = new StateStore(p);
    expect([...reopened.activePositions].sort()).toEqual(["A", "B"]);
    cleanup(p);
  });

  it("getPositionState creates default and keeps per-position state isolated", () => {
    const p = newPath();
    const store = new StateStore(p);
    const a = store.getPositionState("A");
    expect(a.lastLevel).toBe(0);
    store.setActive("A", true);
    a.lastLevel = 3;
    store.persist();
    const reopened = new StateStore(p);
    expect(reopened.getPositionState("A").lastLevel).toBe(3);
    expect(reopened.getPositionState("B").lastLevel).toBe(0);
    cleanup(p);
  });

  it("deactivateAll preserves level state (FR-8.5)", () => {
    const p = newPath();
    const store = new StateStore(p);
    store.setActive("A", true);
    const a = store.getPositionState("A");
    a.lastLevel = 2;
    a.executedLevels = [1, 2];
    expect(store.deactivateAll()).toBe(1);
    const reopened = new StateStore(p);
    expect(reopened.activePositions).toEqual([]);
    expect(reopened.getPositionState("A").executedLevels).toEqual([1, 2]);
    cleanup(p);
  });
});
