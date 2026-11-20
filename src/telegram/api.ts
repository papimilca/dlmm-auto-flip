import logger from "../logger/index.js";

const TELEGRAM_API = "https://api.telegram.org";

/** Minimal Bot API client: sendMessage, getUpdates, answerCallbackQuery, editMessageText. */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly timeoutSec = 30,
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`telegram ${method} HTTP ${res.status}`);
    const json = (await res.json()) as { ok: boolean; result: T };
    if (!json.ok) throw new Error(`telegram ${method} not ok`);
    return json.result;
  }

  sendMessage(chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<void> {
    return this.call<unknown>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }).then(() => undefined);
  }

  answerCallbackQuery(id: string, text?: string): Promise<void> {
    return this.call<unknown>("answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text } : {}),
    }).then(() => undefined);
  }

  /** Register the command list shown by Telegram's autocomplete ("/" menu). */
  setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    return this.call<unknown>("setMyCommands", { commands }).then(() => undefined);
  }

  /** Long-poll; returns updates confirmed (offset committed) by the caller. */
  async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    try {
      return await this.call<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: this.timeoutSec,
        allowed_updates: ["message", "callback_query"],
      });
    } catch (err: unknown) {
      // Transient network/timeout errors must not kill the loop (NFR-1).
      // Include undici's cause (ECONNRESET/ETIMEDOUT/ENOTFOUND) for diagnosis.
      const cause =
        err instanceof Error && err.cause instanceof Error
          ? ` (${err.cause.message})`
          : "";
      logger.warn({ err: `${String(err)}${cause}` }, "telegramGetUpdatesFailed");
      return [];
    }
  }
}

// ---- Bot API payload types (subset actually used) --------------------------

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: TelegramMessage;
  };
}
