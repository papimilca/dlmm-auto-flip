import { describe, expect, it, vi } from "vitest";
import { BN } from "bn.js";
import { Keypair } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import { planWithdrawBase } from "../../src/tx/withdraw.ts";
import { toPubkey } from "../../src/utils/solana.ts";

const POSITION = "6ocDFefJrq5EcfoYtKQEEQPUkgHZa5bRTnbw8uSDuhcK";

function fakePool(positionData: {
  lowerBinId: number;
  upperBinId: number;
  positionBinData: Array<{ binId: number; positionXAmount: string }>;
}) {
  const position = { publicKey: toPubkey(POSITION, "position"), positionData };
  return {
    getPosition: vi.fn().mockResolvedValue(position),
    removeLiquidity: vi.fn().mockResolvedValue([{}, {}]),
  } as unknown as DLMM & { removeLiquidity: ReturnType<typeof vi.fn> };
}

const USER = Keypair.generate().publicKey;

describe("planWithdrawBase (T-4.1)", () => {
  it("plans 100% removal of the base-side bin range", async () => {
    const pool = fakePool({
      lowerBinId: 100,
      upperBinId: 120,
      positionBinData: [
        { binId: 100, positionXAmount: "0" }, // below active (Y side)
        { binId: 110, positionXAmount: "10" },
        { binId: 120, positionXAmount: "15" },
      ],
    });
    const plan = await planWithdrawBase(pool, POSITION, USER, 105);
    expect(plan?.fromBinId).toBe(106);
    expect(plan?.toBinId).toBe(120);
    expect(plan?.baseAmountX).toBe("25");
    expect(pool.removeLiquidity).toHaveBeenCalledWith(
      expect.objectContaining({
        user: USER,
        fromBinId: 106,
        toBinId: 120,
        bps: new BN(10_000),
        shouldClaimAndClose: false,
      }),
    );
  });

  it("clamps fromBinId to the position lower bin", async () => {
    const pool = fakePool({
      lowerBinId: 110,
      upperBinId: 120,
      positionBinData: [{ binId: 110, positionXAmount: "5" }],
    });
    const plan = await planWithdrawBase(pool, POSITION, USER, 100);
    expect(plan?.fromBinId).toBe(110);
  });

  it("returns null when active bin reached the upper bin (no base side)", async () => {
    const pool = fakePool({
      lowerBinId: 110,
      upperBinId: 120,
      positionBinData: [{ binId: 120, positionXAmount: "5" }],
    });
    expect(await planWithdrawBase(pool, POSITION, USER, 120)).toBeNull();
    expect(pool.removeLiquidity).not.toHaveBeenCalled();
  });

  it("returns null when base bins hold no X liquidity", async () => {
    const pool = fakePool({
      lowerBinId: 100,
      upperBinId: 120,
      positionBinData: [{ binId: 115, positionXAmount: "0" }],
    });
    expect(await planWithdrawBase(pool, POSITION, USER, 110)).toBeNull();
    expect(pool.removeLiquidity).not.toHaveBeenCalled();
  });
});
