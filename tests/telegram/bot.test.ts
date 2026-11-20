import { describe, expect, it, vi } from "vitest";
import { TelegramBot, FLIP_ON_PREFIX, FLIP_OFF_PREFIX, type CommandHandlers } from "../../src/telegram/bot.ts";
import type { TelegramApi, TelegramUpdate } from "../../src/telegram/api.ts";

const CHAT = "12345";
const POS = "Pos11111111111111111111111111111111111111111";

function makeHandlers(): CommandHandlers {
  return {
    onPosition: vi.fn().mockResolvedValue(undefined),
    onStop: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn().mockResolvedValue(undefined),
    onFlipToggle: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApi(): TelegramApi {
  return { answerCallbackQuery: vi.fn().mockResolvedValue(undefined) } as unknown as TelegramApi;
}

function msg(text: string, chatId = Number(CHAT)): TelegramUpdate {
  return { update_id: 1, message: { message_id: 10, chat: { id: chatId }, text } };
}

function cb(data: string, chatId = Number(CHAT)): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: { id: "cq1", data, message: { message_id: 11, chat: { id: chatId } } },
  };
}

describe("TelegramBot.handleUpdate (FR-8)", () => {
  it("dispatches /position, /stop, /status commands", async () => {
    const handlers = makeHandlers();
    const bot = new TelegramBot(makeApi(), CHAT, handlers);
    expect(await bot.handleUpdate(msg("/position"))).toBe(true);
    expect(await bot.handleUpdate(msg("/stop"))).toBe(true);
    expect(await bot.handleUpdate(msg("/status"))).toBe(true);
    expect(handlers.onPosition).toHaveBeenCalledWith(CHAT);
    expect(handlers.onStop).toHaveBeenCalledWith(CHAT);
    expect(handlers.onStatus).toHaveBeenCalledWith(CHAT);
  });

  it("dispatches activate callback with position address", async () => {
    const handlers = makeHandlers();
    const api = makeApi();
    const bot = new TelegramBot(api, CHAT, handlers);
    expect(await bot.handleUpdate(cb(`${FLIP_ON_PREFIX}${POS}`))).toBe(true);
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("cq1");
    expect(handlers.onFlipToggle).toHaveBeenCalledWith(CHAT, 11, POS, true);
  });

  it("dispatches deactivate callback", async () => {
    const handlers = makeHandlers();
    const bot = new TelegramBot(makeApi(), CHAT, handlers);
    await bot.handleUpdate(cb(`${FLIP_OFF_PREFIX}${POS}`));
    expect(handlers.onFlipToggle).toHaveBeenCalledWith(CHAT, 11, POS, false);
  });

  it("ignores commands from non-whitelisted chat (FR-8.2)", async () => {
    const handlers = makeHandlers();
    const bot = new TelegramBot(makeApi(), CHAT, handlers);
    expect(await bot.handleUpdate(msg("/stop", 999))).toBe(false);
    expect(await bot.handleUpdate(cb(`${FLIP_ON_PREFIX}${POS}`, 999))).toBe(false);
    expect(handlers.onStop).not.toHaveBeenCalled();
    expect(handlers.onFlipToggle).not.toHaveBeenCalled();
  });

  it("ignores unknown commands and unknown callback data", async () => {
    const handlers = makeHandlers();
    const api = makeApi();
    const bot = new TelegramBot(api, CHAT, handlers);
    expect(await bot.handleUpdate(msg("/help"))).toBe(false);
    expect(await bot.handleUpdate(cb("whatever"))).toBe(false);
    expect(api.answerCallbackQuery).toHaveBeenCalled();
    expect(handlers.onFlipToggle).not.toHaveBeenCalled();
  });
});
