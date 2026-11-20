import { describe, expect, it, vi } from "vitest";
import type { Connection, Keypair, Transaction } from "@solana/web3.js";
import { signAndSend } from "../../src/tx/send.ts";

function fakeTx() {
  return { sign: vi.fn(), serialize: () => new Uint8Array([1, 2, 3]) } as unknown as Transaction;
}

function fakeConnection(failTimes: number) {
  let calls = 0;
  return {
    sendRawTransaction: vi.fn(async () => {
      calls++;
      if (calls <= failTimes) throw new Error("rpc error");
      return `sig-${calls}`;
    }),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  } as unknown as Connection;
}

const wallet = {} as Keypair;

describe("signAndSend (T-4.3, FR-3.6)", () => {
  it("signs, sends, confirms and returns the signature", async () => {
    const connection = fakeConnection(0);
    const tx = fakeTx();
    const sigs = await signAndSend(connection, wallet, [tx], { maxRetries: 1, backoffBaseMs: 1 });
    expect(sigs).toEqual(["sig-1"]);
    expect(tx.sign).toHaveBeenCalledWith(wallet);
  });

  it("retries with backoff and succeeds on a later attempt", async () => {
    const connection = fakeConnection(2);
    const sigs = await signAndSend(connection, wallet, [fakeTx()], {
      maxRetries: 3,
      backoffBaseMs: 1,
    });
    expect(sigs).toEqual(["sig-3"]);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries", async () => {
    const connection = fakeConnection(99);
    await expect(
      signAndSend(connection, wallet, [fakeTx()], { maxRetries: 2, backoffBaseMs: 1 }),
    ).rejects.toThrow("tx failed after 3 attempt(s)");
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(3);
  });

  it("throws when the tx fails on-chain", async () => {
    const connection = {
      sendRawTransaction: vi.fn().mockResolvedValue("sig-x"),
      confirmTransaction: vi.fn().mockResolvedValue({ value: { err: "InstructionFallback" } }),
    } as unknown as Connection;
    await expect(
      signAndSend(connection, wallet, [fakeTx()], { maxRetries: 0, backoffBaseMs: 1 }),
    ).rejects.toThrow("failed on-chain");
  });
});
