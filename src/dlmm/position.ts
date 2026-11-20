import { BN } from "bn.js";
import type { Connection, PublicKey } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import type { LbPosition, PositionData } from "@meteora-ag/dlmm";
import { toPubkey } from "../utils/solana.js";
import { loadDlmmModule } from "./sdk.js";

export interface PositionInfo {
  positionAddress: string;
  lowerBinId: number;
  upperBinId: number;
  /** Price of the upper bin (pricePerToken, decimal string) — reference price (FR-2.2). */
  upperBinPrice: string;
}

/** Wallet position entry: one position account + its pool (FR-2.1, T-6.1). */
export interface WalletPosition {
  positionAddress: string;
  poolAddress: string;
  tokenXSymbol: string;
  tokenYSymbol: string;
  binStep: number;
  lowerBinId: number;
  upperBinId: number;
  /** Price of the position's upper bin (decimal string) or null when not in bin data. */
  upperBinPrice: string | null;
  /** Position X (base) amount (raw, decimal string). */
  totalXAmount: string;
  /** Position Y (quote) amount (raw, decimal string). */
  totalYAmount: string;
}

/** Short mint label (spl-token Mint has no symbol; use mint address prefix). */
function mintLabel(mint: { address: PublicKey }): string {
  return mint.address.toString().slice(0, 4) + "…" + mint.address.toString().slice(-4);
}

/**
 * List ALL DLMM positions of a wallet across pools (FR-2.1).
 * Uses DLMM.getAllLbPairPositionsByUser (T-6.1).
 */
export async function listWalletPositions(
  connection: Connection,
  walletPubkey: PublicKey,
): Promise<WalletPosition[]> {
  const pools = await loadDlmmModule().getAllLbPairPositionsByUser(connection, walletPubkey);
  const out: WalletPosition[] = [];
  for (const [poolAddress, info] of pools) {
    for (const p of info.lbPairPositionsData) {
      const d = p.positionData;
      const upperBin = d.positionBinData.find((b) => b.binId === d.upperBinId);
      out.push({
        positionAddress: p.publicKey.toString(),
        poolAddress,
        tokenXSymbol: mintLabel(info.tokenX.mint),
        tokenYSymbol: mintLabel(info.tokenY.mint),
        binStep: Number(info.lbPair.binStep),
        lowerBinId: d.lowerBinId,
        upperBinId: d.upperBinId,
        upperBinPrice: upperBin?.pricePerToken ?? null,
        totalXAmount: d.totalXAmount,
        totalYAmount: d.totalYAmount,
      });
    }
  }
  return out;
}

/** Load a position by address from the given pool. */
export async function loadPosition(pool: DLMM, positionAddress: string): Promise<LbPosition> {
  const pubkey = toPubkey(positionAddress, "position");
  return pool.getPosition(pubkey);
}

export function toPositionInfo(position: LbPosition): PositionInfo {
  const d = position.positionData;
  return {
    positionAddress: position.publicKey.toString(),
    lowerBinId: d.lowerBinId,
    upperBinId: d.upperBinId,
    upperBinPrice: upperBinPrice(d),
  };
}

/** pricePerToken of the position's upper bin, from positionBinData. */
function upperBinPrice(d: PositionData): string {
  const bin = d.positionBinData.find((b) => b.binId === d.upperBinId);
  if (bin) return bin.pricePerToken;
  throw new Error(`No positionBinData for upper bin ${d.upperBinId}`);
}

/**
 * Sum of base (X) token still held by the position in bins strictly above the
 * active bin (those bins hold only token X — research T-0.4). Decimal string.
 */
export function baseTokenRemaining(d: PositionData, activeBinId: number): string {
  const total = d.positionBinData
    .filter((b) => b.binId > activeBinId)
    .reduce((acc, b) => acc.add(new BN(b.positionXAmount)), new BN(0));
  return total.toString();
}
