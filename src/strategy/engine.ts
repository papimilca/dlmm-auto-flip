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
