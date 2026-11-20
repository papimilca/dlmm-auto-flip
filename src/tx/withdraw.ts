import { BN } from "bn.js";
import type { PublicKey, Transaction } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import { toPubkey } from "../utils/solana.js";
import { baseTokenRemaining } from "../dlmm/position.js";

export interface WithdrawPlan {
  txs: Transaction[];
  /** Base (X) token amount that will land in the wallet (raw, decimal string). */
  baseAmountX: string;
  fromBinId: number;
  toBinId: number;
}

/**
 * Plan the base-side withdraw for one level (FR-3.4/FR-3.5): remove 100% of
 * the position's liquidity in the bins holding token X (strictly above the
 * active bin) — range max(activeBinId+1, lowerBinId)..upperBinId.
 * Returns null when there is no base-side liquidity left.
 */
export async function planWithdrawBase(
  pool: DLMM,
  positionAddress: string,
  user: PublicKey,
  activeBinId: number,
): Promise<WithdrawPlan | null> {
  const position = await pool.getPosition(toPubkey(positionAddress, "position"));
  const d = position.positionData;
  const fromBinId = Math.max(activeBinId + 1, d.lowerBinId);
  if (fromBinId > d.upperBinId) return null;
  const baseAmountX = baseTokenRemaining(d, activeBinId);
  if (new BN(baseAmountX).isZero()) return null;
  const txs = await pool.removeLiquidity({
    user,
    position: position.publicKey,
    fromBinId,
    toBinId: d.upperBinId,
    bps: new BN(10_000), // 100% — withdraw ALL remaining base side (T-0.5)
    shouldClaimAndClose: false,
  });
  return { txs, baseAmountX, fromBinId, toBinId: d.upperBinId };
}
