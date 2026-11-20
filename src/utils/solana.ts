import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export function getConnection(): Connection {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL env is not set");
  return new Connection(rpcUrl, "confirmed");
}

/**
 * Load keypair from SOLANA_WALLET_KEY or WALLET_PATH (file). Never logs the secret.
 * SOLANA_WALLET_KEY accepts (auto-detected):
 * - base58 private key (e.g. Phantom export, 51-52 chars)
 * - base64 private key
 * - JSON keypair array (file id.json content)
 */
export function loadWalletKeypair(): Keypair {
  const raw = process.env.SOLANA_WALLET_KEY?.trim();
  if (raw) return keypairFromString(raw);
  const path = process.env.WALLET_PATH;
  if (!path) throw new Error("Neither SOLANA_WALLET_KEY nor WALLET_PATH is set");
  const file: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(file)) throw new Error(`WALLET_PATH file ${path} is not a JSON keypair array`);
  return Keypair.fromSecretKey(Uint8Array.from(file as number[]));
}

function keypairFromString(raw: string): Keypair {
  // JSON array: [12,34,...]
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
    } catch {
      throw new Error("SOLANA_WALLET_KEY starts with '[' but is not a valid JSON keypair array");
    }
    throw new Error("SOLANA_WALLET_KEY must be a JSON keypair array");
  }

  // base58 (Phantom/Solflare export) or base64 — decode, then validate length.
  for (const decode of [decodeBase58, decodeBase64]) {
    const bytes = decode(raw);
    if (bytes && bytes.length === 64) return Keypair.fromSecretKey(bytes);
  }
  throw new Error("SOLANA_WALLET_KEY is not a valid base58/base64/JSON-array private key");
}

function decodeBase58(s: string): Uint8Array | null {
  try {
    return bs58.decode(s);
  } catch {
    return null;
  }
}

function decodeBase64(s: string): Uint8Array | null {
  try {
    const buf = Buffer.from(s, "base64");
    return buf.toString("base64") === s ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

export function toPubkey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid ${label} pubkey: ${value}`);
  }
}
