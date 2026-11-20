import logger, { logAction } from "../logger/index.js";
import { TelegramApi, type TelegramUpdate } from "./api.js";

/** Callback data prefixes for the toggle button (label fixed at render time). */
export const FLIP_ON_PREFIX = "flip_on:";
export const FLIP_OFF_PREFIX = "flip_off:";

/** Handlers wired by the app (commands + button toggles, FR-8). */
export interface CommandHandlers {
  onPosition(chatId: string): Promise<void>;
  onStop(chatId: string): Promise<void>;
  onStatus(chatId: string): Promise<void>;
  /** Toggle button pressed for a position. `activate` comes from the callback data. */
  onFlipToggle(chatId: string, messageId: number, positionAddress: string, activate: boolean): Promise<void>;
}

/**
 * Telegram command & control bot (FR-8).
 * Long-polls getUpdates in a single loop; only the whitelisted chat is
 * processed (FR-8.2). The loop never throws — poll errors are logged inside
 * TelegramApi.getUpdates and retried.
 */
export class TelegramBot {
  private offset = 0;

  constructor(
    private readonly api: TelegramApi,
    private readonly chatId: string,
    private readonly handlers: CommandHandlers,
  ) {}

  /** Dispatch one update (whitelist check inside). Exposed for unit tests. */
  async handleUpdate(update: TelegramUpdate): Promise<boolean> {
    const fromChat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (fromChat === undefined || String(fromChat) !== this.chatId) {
      logAction("telegramIgnoredUpdate", { chatId: fromChat }); // FR-8.2
      return false;
    }
    const chatId = this.chatId;

    if (update.message?.text) {
      const text = update.message.text.trim();
      switch (text.split(/\s+/)[0].toLowerCase()) {
        case "/position":
        case "/positions":
          await this.handlers.onPosition(chatId);
          return true;
        case "/stop":
          await this.handlers.onStop(chatId);
          return true;
        case "/status":
          await this.handlers.onStatus(chatId);
          return true;
        default:
          logger.debug({ text }, "telegramUnknownCommand");
          return false;
      }
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data ?? "";
      const activate = data.startsWith(FLIP_ON_PREFIX);
      const deactivate = data.startsWith(FLIP_OFF_PREFIX);
      if ((activate || deactivate) && cq.message) {
        const positionAddress = data.slice((activate ? FLIP_ON_PREFIX : FLIP_OFF_PREFIX).length);
        await this.api.answerCallbackQuery(cq.id);
        await this.handlers.onFlipToggle(chatId, cq.message.message_id, positionAddress, activate);
        return true;
      }
      await this.api.answerCallbackQuery(cq.id);
      return false;
    }
    return false;
  }

  /** Main long-poll loop. Runs forever; rejects only on fatal errors. */
  async run(): Promise<void> {
    // Best-effort command registration for Telegram's "/" autocomplete menu.
    await this.api
      .setMyCommands([
        { command: "position", description: "List DLMM positions" },
        { command: "status", description: "Show engine status" },
        { command: "stop", description: "Stop the engine" },
      ])
      .catch((err: unknown) => {
        logger.warn({ err: String(err) }, "telegramSetMyCommandsFailed");
      });
    logAction("telegramBotStarted", { chatId: this.chatId });
    for (;;) {
      const updates = await this.api.getUpdates(this.offset);
      for (const u of updates) {
        if (u.update_id >= this.offset) this.offset = u.update_id + 1;
        await this.handleUpdate(u).catch((err: unknown) => {
          logger.error({ err: String(err) }, "telegramHandleUpdateFailed");
        });
      }
    }
  }
}
