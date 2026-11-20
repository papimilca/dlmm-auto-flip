import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/** Log a strategy action event (JSONL, FR-5.3 / NFR-4). */
export function logAction(action: string, data: Record<string, unknown>): void {
  logger.info({ action, ...data }, action);
}

export default logger;
