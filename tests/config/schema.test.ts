import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.ts";

const valid = {};

describe("configSchema", () => {
  it("accepts empty config and applies defaults", () => {
    const cfg = configSchema.parse(valid);
    expect(cfg.stepPct).toBe(-20);
    expect(cfg.maxSteps).toBe(5);
    expect(cfg.triggerMode).toBe("pricePct");
    expect(cfg.dryRun).toBe(true);
    expect(cfg.pollIntervalMs).toBe(5000);
    expect(cfg.txMaxRetries).toBe(3);
    expect(cfg.telegramPollTimeoutSec).toBe(30);
  });

  it("accepts triggerMode pricePct|binPct and rejects other values", () => {
    expect(configSchema.parse({ ...valid, triggerMode: "binPct" }).triggerMode).toBe("binPct");
    expect(configSchema.parse({ ...valid, triggerMode: "pricePct" }).triggerMode).toBe("pricePct");
    expect(() => configSchema.parse({ ...valid, triggerMode: "bin" })).toThrow();
  });

  it("rejects legacy poolAddress/positionAddress (removed in v0.4)", () => {
    expect(() =>
      configSchema.parse({ ...valid, poolAddress: "3uetDDizgTcDHmK3HzLr1Z7AY7d6nu6vubt3h47Wdupg" }),
    ).toThrow();
  });

  it("rejects stepPct = 0 / positive", () => {
    expect(() => configSchema.parse({ ...valid, stepPct: 0 })).toThrow();
    expect(() => configSchema.parse({ ...valid, stepPct: 20 })).toThrow();
  });

  it("rejects non-positive maxSteps", () => {
    expect(() => configSchema.parse({ ...valid, maxSteps: 0 })).toThrow();
  });

  it("rejects bidAskBinRange (removed — re-add goes to the same position, v0.4)", () => {
    expect(() => configSchema.parse({ ...valid, bidAskBinRange: 25 })).toThrow();
  });

  it("rejects slippage out of range and poll timeout out of range", () => {
    expect(() => configSchema.parse({ ...valid, slippageBps: 20_000 })).toThrow();
    expect(() => configSchema.parse({ ...valid, telegramPollTimeoutSec: 1 })).toThrow();
    expect(() => configSchema.parse({ ...valid, telegramPollTimeoutSec: 500 })).toThrow();
  });
});
