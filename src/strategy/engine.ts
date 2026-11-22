import { Decimal } from "decimal.js";

export interface PriceEvent {
  activeBinId: number;
  /** Human-readable active bin price (decimal string). */
  currentPrice: string;
}

export interface LevelReached {
  /** Level index N (1-based). */
  level: number;
  /** Trigger price of the reached level (decimal string). */
  levelPrice: string;
  /** currentPrice / upperBinPrice as percent (additive step basis). */
  pctOfUpper: string;
}

/**
 * Additive step levels from the upper bin price (FR-3.1):
 * levelN price = upperBinPrice * (1 + stepPct/100 * N).
 * Pure function — all prices are decimal strings, never floats.
 */
export function levelPrice(upperBinPrice: string, stepPct: number, level: number): string {
  return new Decimal(upperBinPrice)
    .mul(new Decimal(1).add(new Decimal(stepPct).div(100).mul(level)))
    .toFixed();
}

/**
 * Evaluate which next level the current price has touched/passed (FR-3.2).
 * Returns null if the next level is not reached or already executed.
 * Levels strictly below lastLevel are skipped (idempotency, FR-3.3).
 */
export function evaluateLevel(
  currentPrice: string,
  upperBinPrice: string,
  stepPct: number,
  maxSteps: number,
  lastLevel: number,
): LevelReached | null {
  const next = lastLevel + 1;
  if (next > maxSteps) return null; // FR-6.2: beyond maxSteps — stop executing
  const threshold = levelPrice(upperBinPrice, stepPct, next);
  if (new Decimal(currentPrice).lessThanOrEqualTo(threshold)) {
    const pct = new Decimal(currentPrice).div(upperBinPrice).mul(100).toFixed(2);
    return { level: next, levelPrice: threshold, pctOfUpper: pct };
  }
  return null;
}

export interface LevelReachedBin {
  /** Level index N (1-based). */
  level: number;
  /** Active bin must be at/below this bin ID for the level to trigger. */
  thresholdBinId: number;
}

/**
 * binPct mode: step size as a percentage of the position's bin width
 * (Q-11). Integer math only — no price conversion needed.
 * stepBins = floor((upperBinId - lowerBinId) * |stepPct| / 100), min 1.
 */
export function stepBinCount(lowerBinId: number, upperBinId: number, stepPct: number): number {
  const binWidth = upperBinId - lowerBinId;
  return Math.max(Math.floor((binWidth * Math.abs(stepPct)) / 100), 1);
}

/** binPct mode: trigger bin of level N (FR-3.1 variant). */
export function levelBinId(upperBinId: number, stepBins: number, level: number): number {
  return upperBinId - stepBins * level;
}

/**
 * binPct mode equivalent of evaluateLevel: triggers when the active bin
 * is at/below the level's threshold bin. Same idempotency/maxSteps rules
 * (FR-3.3, FR-6.2).
 */
export function evaluateLevelByBin(
  activeBinId: number,
  lowerBinId: number,
  upperBinId: number,
  stepPct: number,
  maxSteps: number,
  lastLevel: number,
): LevelReachedBin | null {
  const next = lastLevel + 1;
  if (next > maxSteps) return null; // FR-6.2
  const threshold = levelBinId(upperBinId, stepBinCount(lowerBinId, upperBinId, stepPct), next);
  if (activeBinId <= threshold) {
    return { level: next, thresholdBinId: threshold };
  }
  return null;
}

// ---- Reverse flip (FR-9, adaptive loop) ------------------------------------

export interface ReverseReached {
  /** Level being reversed (== current lastLevel). */
  level: number;
  /** Threshold of that level (bin ID or price depending on mode). */
  thresholdBinId?: number;
  levelPrice?: string;
}

/**
 * pricePct mode: the reverse of `lastLevel` triggers when the price has
 * recovered STRICTLY ABOVE that level's threshold (FR-9.1).
 */
export function evaluateReverse(
  currentPrice: string,
  upperBinPrice: string,
  stepPct: number,
  lastLevel: number,
): ReverseReached | null {
  if (lastLevel < 1) return null;
  const threshold = levelPrice(upperBinPrice, stepPct, lastLevel);
  if (new Decimal(currentPrice).greaterThan(threshold)) {
    return { level: lastLevel, levelPrice: threshold };
  }
  return null;
}

/**
 * binPct mode: the reverse of `lastLevel` triggers when the active bin is
 * STRICTLY ABOVE that level's threshold bin (FR-9.1).
 */
export function evaluateReverseByBin(
  activeBinId: number,
  lowerBinId: number,
  upperBinId: number,
  stepPct: number,
  lastLevel: number,
): ReverseReached | null {
  if (lastLevel < 1) return null;
  const threshold = levelBinId(upperBinId, stepBinCount(lowerBinId, upperBinId, stepPct), lastLevel);
  if (activeBinId > threshold) {
    return { level: lastLevel, thresholdBinId: threshold };
  }
  return null;
}

// ---- Sweep validation (FR-10) ----------------------------------------------

/** Actions subject to sweep validation (tx-executing decisions only). */
export type TriggerAction = "EXECUTE_LEVEL" | "REVERSE_LEVEL";

/**
 * Consecutive-poll confirmation state for one position monitor (FR-10.3:
 * in-memory, not persisted).
 */
export interface SweepStreak {
  action: TriggerAction;
  level: number;
  count: number;
}

export interface SweepUpdate {
  /** Updated streak state (null = cleared). */
  streak: SweepStreak | null;
  /** True when the trigger is confirmed and may execute (FR-10.1). */
  confirmed: boolean;
}

/**
 * Advance the sweep-validation streak with one tick's decision (FR-10.1/10.2).
 * Pure — the caller owns the streak. `decision` is null when this tick
 * produced no tx-executing action (MONITOR / MAX_STEPS_EXCEEDED resets).
 */
export function updateSweepStreak(
  streak: SweepStreak | null,
  decision: { action: TriggerAction; level: number } | null,
  confirmations: number,
): SweepUpdate {
  if (!decision) return { streak: null, confirmed: false };
  const same =
    streak !== null && streak.action === decision.action && streak.level === decision.level;
  const count = same ? streak.count + 1 : 1;
  const next: SweepStreak = { action: decision.action, level: decision.level, count };
  return { streak: next, confirmed: count >= confirmations };
}
