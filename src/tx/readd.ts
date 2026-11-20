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
 */
export async function planReAddBase(
  pool: DLMM,
  positionAddress: string,
  user: PublicKey,
  baseAmountX: BNType,
  minBinId: number,
  maxBinId: number,
  slippageBps: number,
): Promise<Transaction> {
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
    slippage: slippageBps / 100,
  });
}
