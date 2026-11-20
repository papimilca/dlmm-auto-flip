import logger from "../logger/index.js";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Telegram notifier (FR-7). Env-based, safe no-op when unset, non-blocking,
 * never logs the token. One light retry on failure.
 */
export class TelegramNotifier {
  private readonly token: string | undefined;
  private readonly chatId: string | undefined;

  constructor(token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID) {
    this.token = token?.trim() || undefined;
    this.chatId = chatId?.trim() || undefined;
  }

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  /** Fire-and-forget send. Failures are logged but never thrown (FR-7.5). */
  send(text: string): void {
    if (!this.enabled) return;
    void this.post(text)
      .catch(() => this.post(text)) // single retry
      .catch((err: unknown) =>
        logger.warn({ err: String(err) }, "telegramSendFailed"),
      );
  }

  private async post(text: string): Promise<void> {
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) throw new Error(`telegram sendMessage HTTP ${res.status}`);
  }
}
