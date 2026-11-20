import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramNotifier } from "../../src/notify/telegram.ts";

afterEach(() => vi.unstubAllEnvs());

describe("TelegramNotifier", () => {
  it("is disabled when env not set (FR-7.4)", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(new TelegramNotifier().enabled).toBe(false);
  });

  it("is enabled when env set", () => {
    const n = new TelegramNotifier("t", "c");
    expect(n.enabled).toBe(true);
  });

  it("does not call fetch when disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    new TelegramNotifier().send("hi");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends once when ok, retries once on failure, never throws (FR-7.5)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const n = new TelegramNotifier("t", "c");
    n.send("hello");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const failThenOk = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", failThenOk);
    n.send("retry");
    await vi.waitFor(() => expect(failThenOk).toHaveBeenCalledTimes(2));
  });

  it("swallows total failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const n = new TelegramNotifier("t", "c");
    expect(() => n.send("bye")).not.toThrow();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
