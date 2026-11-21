import { describe, expect, it, vi } from "vitest";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { getWalletTokenBalance, getWalletBalanceForMint, WSOL_MINT } from "../../src/utils/solana.ts";

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

describe("getWalletBalanceForMint (wSOL unwrapped to native SOL)", () => {
  const owner = Keypair.generate().publicKey;

  function fakeSolConnection(lamports: number) {
    return {
      getBalance: vi.fn().mockResolvedValue(lamports),
    } as unknown as Connection;
  }

  it("reads native SOL balance minus fee reserve when mint is wSOL", async () => {
    const conn = fakeSolConnection(200_000_000);
    // 200,000,000 - 10,000,000 fee reserve
    expect((await getWalletBalanceForMint(conn, owner, WSOL_MINT)).toString()).toBe("190000000");
  });

  it("returns 0 when native SOL is below the fee reserve", async () => {
    const conn = fakeSolConnection(5_000_000);
    expect((await getWalletBalanceForMint(conn, owner, WSOL_MINT)).isZero()).toBe(true);
  });

  it("falls back to token accounts for non-wSOL mints", async () => {
    const mint = Keypair.generate().publicKey;
    const conn = fakeConnection([tokenAccount(new BN(123))]);
    expect((await getWalletBalanceForMint(conn, owner, mint)).toString()).toBe("123");
  });
});
