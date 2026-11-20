import { BN } from "bn.js";
import type { BN as BNType } from "@coral-xyz/anchor";
import type { PublicKey, Transaction } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import { toPubkey } from "../utils/solana.js";
import { loadSdkModule } from "../dlmm/sdk.js";

/**
 * Plan the re-add for one level (FR-4.1a/FR-4.2): put the withdrawn base (X)
 * token back into the SAME position, single-sided X, over the base-side bins
 * the position owns (minBinId..maxBinId — both strictly above the active bin).
 * Slippage comes from config in bps; the SDK expects a percentage (FR-4.3).
 *
 * The on-chain check is "active bin moved ≤ maxActiveBinSlippage bins since
 * tx build time" (error 6004 ExceededBinSlippageTolerance). The SDK derives
 * that bin count as ceil(slippagePct / binStepPct), so for coarse binStep
 * pools a small pct slippage can yield a tolerance of only 1 bin. We widen
 * the effective slippage so at least MIN_BIN_SLIPPAGE_COVERAGE bins are
 * tolerated — price is dropping fast at trigger time, so the active bin can
 * legitimately shift several bins while the tx is in flight.
 */
const MIN_BIN_SLIPPAGE_COVERAGE = 10;

export async function planReAddBase(
  pool: DLMM,
  positionAddress: string,
  user: PublicKey,
  baseAmountX: BNType,
  minBinId: number,
  maxBinId: number,
  slippageBps: number,
): Promise<Transaction> {
  const configPct = slippageBps / 100;
  const binStepPct = pool.lbPair.binStep / 100;
  const slippage = Math.max(configPct, MIN_BIN_SLIPPAGE_COVERAGE * binStepPct);
  return pool.addLiquidityByStrategy({
    positionPubKey: toPubkey(positionAddress, "position"),
    totalXAmount: baseAmountX,
    totalYAmount: new BN(0),
    strategy: {
      minBinId,
      maxBinId,
      strategyType: loadSdkModule().StrategyType.BidAsk,
      singleSidedX: true,
    },
    user,
    slippage,
  });
}
