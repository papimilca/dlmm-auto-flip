import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import { toPubkey } from "../utils/solana.js";
import { loadDlmmModule } from "./sdk.js";

export interface PoolSnapshot {
  /** Active bin id of the pool. */
  activeBinId: number;
  /** Human-readable price of the active bin (decimal string). */
  activeBinPrice: string;
  /** Bin step in bps. */
  binStep: number;
  tokenXMint: string;
  tokenYMint: string;
}

/** Load a DLMM pool by address (validates the pubkey). */
export async function loadPool(connection: Connection, poolAddress: string): Promise<DLMM> {
  const pubkey = toPubkey(poolAddress, "pool");
  return loadDlmmModule().create(connection, pubkey);
}

export async function getPoolSnapshot(pool: DLMM): Promise<PoolSnapshot> {
  const activeBin = await pool.getActiveBin();
  return {
    activeBinId: activeBin.binId,
    activeBinPrice: activeBin.pricePerToken,
    binStep: Number(pool.lbPair.binStep),
    tokenXMint: pool.tokenX.mint.address.toString(),
    tokenYMint: pool.tokenY.mint.address.toString(),
  };
}
