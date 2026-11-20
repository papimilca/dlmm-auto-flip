import { describe, expect, it, vi, beforeEach } from "vitest";
import { BN } from "bn.js";
import { Keypair } from "@solana/web3.js";
import type DLMM from "@meteora-ag/dlmm";
import { loadSdkModule } from "../../src/dlmm/sdk.ts";
import type { Connection } from "@solana/web3.js";
import { toPubkey } from "../../src/utils/solana.ts";
import type { LevelExecution } from "../../src/strategy/monitor.ts";
import type { TelegramNotifier } from "../../src/notify/telegram.ts";
import type { AppConfig } from "../../src/config/schema.ts";

const { loadPoolMock, signAndSendMock } = vi.hoisted(() => ({
  loadPoolMock: vi.fn(),
  signAndSendMock: vi.fn(),
}));

vi.mock("../../src/dlmm/pool.ts", () => ({ loadPool: loadPoolMock }));
vi.mock("../../src/tx/send.ts", () => ({ signAndSend: signAndSendMock }));

import { liveExecutor } from "../../src/tx/live.ts";

const POSITION = "6ocDFefJrq5EcfoYtKQEEQPUkgHZa5bRTnbw8uSDuhcK";
const POOL = "4e9ismoKcsCpFqKmSsVvGdVZLp8cyKzz7wLwr1HqoXFM";

function fakePool(activeBinId: number, baseAmount: string) {
  const positionData = {
    lowerBinId: 100,
    upperBinId: 120,
    positionBinData: [
      { binId: 110, positionXAmount: baseAmount },
      { binId: 120, positionXAmount: "0" },
    ],
  };
  return {
    getActiveBin: vi.fn().mockResolvedValue({ binId: activeBinId, pricePerToken: "80" }),
    getPosition: vi.fn().mockResolvedValue({ publicKey: toPubkey(POSITION, "position"), positionData }),
    removeLiquidity: vi.fn().mockResolvedValue([{}]),
    addLiquidityByStrategy: vi.fn().mockResolvedValue({}),
  } as unknown as DLMM & Record<string, ReturnType<typeof vi.fn>>;
}

function deps(pool: DLMM, sendResult: string[] | Error) {
  signAndSendMock.mockReset();
  if (sendResult instanceof Error) {
    signAndSendMock.mockRejectedValue(sendResult);
  } else {
    signAndSendMock.mockResolvedValue(sendResult);
  }
  const notifier = { send: vi.fn() } as unknown as TelegramNotifier;
  return {
    notifier,
    configDeps: {
      connection: {} as Connection,
      wallet: Keypair.generate(),
      config: { txMaxRetries: 2, slippageBps: 100 } as unknown as AppConfig,
      notifier,
    },
    pool,
  };
}

const EXEC: LevelExecution = {
  positionAddress: POSITION,
  poolAddress: POOL,
  level: 1,
  levelPrice: "80",
  thresholdBinId: null,
  pctOfUpper: "80.00",
  currentPrice: "79.5",
  activeBinId: 105,
  minBinId: 106,
  maxBinId: 120,
};

describe("liveExecutor (T-4.1/T-4.2 integration)", () => {
  beforeEach(() => {
    loadPoolMock.mockReset();
  });

  it("withdraws all base-side liquidity then re-adds it to the same position", async () => {
    const pool = fakePool(105, "25");
    const { configDeps, notifier } = deps(pool, ["sig-a", "sig-b"]);
    loadPoolMock.mockResolvedValue(pool);

    await liveExecutor(configDeps)(EXEC);

    expect(pool.removeLiquidity).toHaveBeenCalledWith(
      expect.objectContaining({ fromBinId: 106, toBinId: 120, bps: new BN(10_000), shouldClaimAndClose: false }),
    );
    expect(pool.addLiquidityByStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        totalXAmount: new BN(25),
        totalYAmount: new BN(0),
        strategy: {
          minBinId: 106,
          maxBinId: 120,
          strategyType: loadSdkModule().StrategyType.BidAsk,
          singleSidedX: true,
        },
      }),
    );
    expect(signAndSendMock).toHaveBeenCalledTimes(2);
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });

  it("skips the level (no tx) when there is no base liquidity left", async () => {
    const pool = fakePool(105, "0");
    const { configDeps, notifier } = deps(pool, ["sig"]);
    loadPoolMock.mockResolvedValue(pool);

    await liveExecutor(configDeps)(EXEC);

    expect(pool.removeLiquidity).not.toHaveBeenCalled();
    expect(signAndSendMock).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifier.send).mock.calls[0][0]).toContain("no base liquidity left");
  });

  it("propagates send failures so the engine stops the cycle (FR-3.6)", async () => {
    const pool = fakePool(105, "25");
    const { configDeps } = deps(pool, new Error("send failed"));
    loadPoolMock.mockResolvedValue(pool);

    await expect(liveExecutor(configDeps)(EXEC)).rejects.toThrow("send failed");
  });
});
