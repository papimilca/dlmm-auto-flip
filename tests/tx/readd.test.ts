import { describe, expect, it, vi } from "vitest";
import { BN } from "bn.js";
import { Keypair } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import { loadSdkModule } from "../../src/dlmm/sdk.ts";
import { planReAddBase } from "../../src/tx/readd.ts";

const POSITION = "6ocDFefJrq5EcfoYtKQEEQPUkgHZa5bRTnbw8uSDuhcK";
const USER = Keypair.generate().publicKey;

describe("planReAddBase (T-4.2)", () => {
  it("adds single-sided X back to the SAME position base-side bins", async () => {
    const addLiquidityByStrategy = vi.fn().mockResolvedValue({});
    const pool = { addLiquidityByStrategy } as unknown as DLMM;
    await planReAddBase(pool, POSITION, USER, new BN(25), 106, 120, 100);
    expect(addLiquidityByStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        positionPubKey: expect.anything(),
        totalXAmount: new BN(25),
        totalYAmount: new BN(0),
        strategy: {
          minBinId: 106,
          maxBinId: 120,
          strategyType: loadSdkModule().StrategyType.BidAsk,
          singleSidedX: true,
        },
        user: USER,
        slippage: 1, // 100 bps → 1%
      }),
    );
  });
});
