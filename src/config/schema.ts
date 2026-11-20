import { z } from "zod";

export const triggerModeSchema = z.enum(["pricePct", "binPct"]);
export type TriggerMode = z.infer<typeof triggerModeSchema>;

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
});

export type AppConfig = z.infer<typeof configSchema>;
