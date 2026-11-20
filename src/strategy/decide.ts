import { Decimal } from "decimal.js";
import {
  evaluateLevel,
  evaluateLevelByBin,
  levelBinId,
  levelPrice,
  stepBinCount,
  type LevelReached,
} from "./engine.js";
import type { TriggerMode } from "../config/schema.js";
import { CycleStateMachine } from "./cycle.js";

export interface StrategyDecision {
  action: "MONITOR" | "EXECUTE_LEVEL" | "MAX_STEPS_EXCEEDED";
  level: number | null;
  /** pricePct mode: trigger price of the level; null in binPct mode. */
  levelPrice: string | null;
  /** currentPrice / upperBinPrice as percent (informational). */
  pctOfUpper: string | null;
  /** binPct mode: trigger bin of the level; null in pricePct mode. */
  thresholdBinId: number | null;
  /** Base-side bins of the position for the re-add (activeBin..upperBin, FR-4.1a). */
  minBinId: number | null;
  maxBinId: number | null;
}

export interface StrategyParams {
  stepPct: number;
  maxSteps: number;
  triggerMode: TriggerMode;
}

/**
 * Decide what to do for one price tick (pure; FR-3.2, FR-6.2).
 * - EXECUTE_LEVEL: next level touched/passed and not yet executed.
 * - MAX_STEPS_EXCEEDED: price/bin beyond the last allowed level → alert only.
 * - MONITOR: nothing to do.
 *
 * triggerMode "pricePct": levels from the upper bin price (FR-3.1).
 * triggerMode "binPct": levels as a % of the position's bin width (Q-11).
 */
export function decide(
  currentPrice: string,
  upperBinPrice: string,
  activeBinId: number,
  lowerBinId: number,
  upperBinId: number,
  params: StrategyParams,
  sm: CycleStateMachine,
): StrategyDecision {
  if (params.triggerMode === "binPct") {
    const reached = evaluateLevelByBin(
      activeBinId,
      lowerBinId,
      upperBinId,
      params.stepPct,
      params.maxSteps,
      sm.lastLevel,
    );
    if (reached) {
      return {
        action: "EXECUTE_LEVEL",
        level: reached.level,
        levelPrice: null,
        pctOfUpper: pctOf(currentPrice, upperBinPrice),
        thresholdBinId: reached.thresholdBinId,
        // Re-add goes into the SAME position: base token fills the bins the
        // position already owns above the active bin (FR-4.1a).
        minBinId: Math.max(activeBinId + 1, lowerBinId),
        maxBinId: upperBinId,
      };
    }
    // Beyond maxSteps: active bin below the deepest allowed threshold → alert (FR-6.2).
    if (sm.lastLevel >= params.maxSteps) {
      const deepest = levelBinId(
        upperBinId,
        stepBinCount(lowerBinId, upperBinId, params.stepPct),
        params.maxSteps,
      );
      if (activeBinId < deepest) {
        return { action: "MAX_STEPS_EXCEEDED", level: null, levelPrice: null, pctOfUpper: null, thresholdBinId: deepest, minBinId: null, maxBinId: null };
      }
    }
    return { action: "MONITOR", level: null, levelPrice: null, pctOfUpper: null, thresholdBinId: null, minBinId: null, maxBinId: null };
  }

  const reached: LevelReached | null = evaluateLevel(
    currentPrice,
    upperBinPrice,
    params.stepPct,
    params.maxSteps,
    sm.lastLevel,
  );

  if (reached) {
    return {
      action: "EXECUTE_LEVEL",
      level: reached.level,
      levelPrice: reached.levelPrice,
      pctOfUpper: reached.pctOfUpper,
      thresholdBinId: null,
      // Re-add goes into the SAME position: base token fills the bins the
      // position already owns above the active bin (FR-4.1a — decision (a)).
      minBinId: Math.max(activeBinId + 1, lowerBinId),
      maxBinId: upperBinId,
    };
  }

  // Beyond maxSteps: price below the deepest allowed level → alert (FR-6.2).
  if (sm.lastLevel >= params.maxSteps) {
    const deepest = levelPrice(upperBinPrice, params.stepPct, params.maxSteps);
    if (new Decimal(currentPrice).lessThan(deepest)) {
      return { action: "MAX_STEPS_EXCEEDED", level: null, levelPrice: deepest, pctOfUpper: null, thresholdBinId: null, minBinId: null, maxBinId: null };
    }
  }

  return { action: "MONITOR", level: null, levelPrice: null, pctOfUpper: null, thresholdBinId: null, minBinId: null, maxBinId: null };
}

function pctOf(currentPrice: string, upperBinPrice: string): string {
  return new Decimal(currentPrice).div(upperBinPrice).mul(100).toFixed(2);
}
