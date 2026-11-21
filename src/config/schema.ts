import { z } from "zod";

export const triggerModeSchema = z.enum(["pricePct", "binPct"]);
export type TriggerMode = z.infer<typeof triggerModeSchema>;

/** Reverse flip re-add strategy (FR-9.3). */
export const reverseStrategySchema = z.enum(["bidask", "hybrid"]);
export type ReverseStrategy = z.infer<typeof reverseStrategySchema>;

/** Reverse flip config (FR-9, adaptive loop). */
export const reverseFlipSchema = z
  .strictObject({
    enabled: z.boolean().default(true),
    strategy: reverseStrategySchema.default("bidask"),
    /** hybrid only: % of withdrawn Y re-added as bid-ask; rest as spot (FR-9.3). */
    hybridBidAskPct: z.number().min(0).max(100).default(50),
  })
  .default({ enabled: true, strategy: "bidask", hybridBidAskPct: 50 });
export type ReverseFlipConfig = z.infer<typeof reverseFlipSchema>;

export const configSchema = z.strictObject({
  stepPct: z.number().negative().default(-20),
  /**
   * Level basis: "pricePct" = additive steps from the upper bin price
   * (FR-3.1); "binPct" = steps sized as a percentage of the position's
   * bin width, evaluated on bin IDs (integer, no price math).
   */
  triggerMode: triggerModeSchema.default("pricePct"),
  maxSteps: z.number().int().positive().default(5),
  slippageBps: z.number().int().min(0).max(10_000).default(100),
  dryRun: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(500).default(5_000),
  txMaxRetries: z.number().int().min(0).default(3),
  /** Telegram getUpdates long-poll timeout in seconds (FR-8.1). */
  telegramPollTimeoutSec: z.number().int().min(5).max(50).default(30),
  /** Adaptive loop: flip back when price recovers past an executed level (FR-9). */
  reverseFlip: reverseFlipSchema,
});

export type AppConfig = z.infer<typeof configSchema>;
