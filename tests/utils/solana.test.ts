import { describe, expect, it, vi } from "vitest";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { getWalletTokenBalance } from "../../src/utils/solana.ts";

/** SPL token account: amount u64 at offset 64. */
function tokenAccount(amount: BN): Buffer {
  const buf = Buffer.alloc(165);
  amount.toArrayLike(Buffer, "le", 8).copy(buf, 64);
  return buf;
}

function fakeConnection(accounts: Buffer[]) {
  return {
    getTokenAccountsByOwner: vi.fn().mockResolvedValue({
      value: accounts.map((data) => ({ account: { data } })),
    }),
  } as unknown as Connection;
}

describe("getWalletTokenBalance", () => {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  it("returns the account balance (little-endian u64 at offset 64)", async () => {
    const conn = fakeConnection([tokenAccount(new BN(1_000))]);
    expect((await getWalletTokenBalance(conn, owner, mint)).toString()).toBe("1000");
  });

  it("returns 0 when no token account exists", async () => {
    const conn = fakeConnection([]);
    expect((await getWalletTokenBalance(conn, owner, mint)).isZero()).toBe(true);
  });

  it("returns the largest account when multiple ATAs exist", async () => {
    const conn = fakeConnection([tokenAccount(new BN(5)), tokenAccount(new BN(500))]);
    expect((await getWalletTokenBalance(conn, owner, mint)).toString()).toBe("500");
  });

  it("accepts PublicKey inputs", async () => {
    const conn = fakeConnection([tokenAccount(new BN(7))]);
    expect(
      (await getWalletTokenBalance(conn, new PublicKey(owner), new PublicKey(mint))).toString(),
    ).toBe("7");
  });
});
