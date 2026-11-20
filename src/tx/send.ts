import type { Connection, Keypair, Transaction } from "@solana/web3.js";
import logger from "../logger/index.js";

export interface SendOptions {
  /** Send retries per tx on top of the first attempt (FR-3.6). */
  maxRetries: number;
  /** Linear backoff base in ms (attempt N waits N × base). */
  backoffBaseMs?: number;
}

/**
 * Sign SDK-built transactions with the wallet keypair and send them in order,
 * confirming each before sending the next (FR-3.6: retry + backoff).
 * Returns the confirmed transaction signatures in send order.
 */
export async function signAndSend(
  connection: Connection,
  wallet: Keypair,
  txs: Transaction[],
  opts: SendOptions,
): Promise<string[]> {
  const signatures: string[] = [];
  for (const tx of txs) {
    tx.sign(wallet);
    signatures.push(await sendWithRetry(connection, tx, opts));
  }
  return signatures;
}

async function sendWithRetry(
  connection: Connection,
  tx: Transaction,
  opts: SendOptions,
): Promise<string> {
  const maxAttempts = opts.maxRetries + 1;
  const backoffBaseMs = opts.backoffBaseMs ?? 2_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const signature = await connection.sendRawTransaction(tx.serialize());
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`tx ${signature} failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
      }
      logger.info({ txSignature: signature }, "txConfirmed");
      return signature;
    } catch (err: unknown) {
      lastErr = err;
      logger.warn({ err: String(err), attempt, maxAttempts }, "txAttemptFailed");
      if (attempt < maxAttempts) await sleep(backoffBaseMs * attempt);
    }
  }
  throw new Error(`tx failed after ${maxAttempts} attempt(s): ${String(lastErr)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
