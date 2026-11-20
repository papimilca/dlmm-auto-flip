import "dotenv/config";
import { loadConfig } from "./config/loader.js";
import logger, { logAction } from "./logger/index.js";
import { getConnection, loadWalletKeypair } from "./utils/solana.js";
import { StateStore } from "./state/persistence.js";
import { TelegramNotifier } from "./notify/telegram.js";
import { TelegramApi } from "./telegram/api.js";
import { TelegramBot, FLIP_ON_PREFIX, FLIP_OFF_PREFIX, type CommandHandlers } from "./telegram/bot.js";
import { FlipEngine, type LevelExecution } from "./strategy/monitor.js";
import { liveExecutor } from "./tx/live.js";
import type { WalletPosition } from "./dlmm/position.js";
import type { AppConfig } from "./config/schema.js";

const CONFIG_PATH = process.argv[2] ?? "config.json";
const STATE_PATH = process.env.STATE_PATH ?? "state/state.json";

function positionMessage(p: WalletPosition, active: boolean): string {
  return (
    `*${p.tokenXSymbol}/${p.tokenYSymbol}* — flip ${active ? "🟢 ACTIVE" : "⚪ idle"}\n` +
    `pool: \`${p.poolAddress}\`\n` +
    `position: \`${p.positionAddress}\`\n` +
    `bins: ${p.lowerBinId}–${p.upperBinId} (binStep ${p.binStep})\n` +
    `upperBinPrice: ${p.upperBinPrice ?? "n/a"}\n` +
    `amounts: X \`${p.totalXAmount}\` · Y \`${p.totalYAmount}\``
  );
}

function positionKeyboard(p: WalletPosition, active: boolean) {
  return {
    inline_keyboard: [
      [
        active
          ? { text: "Deactivate Flip", callback_data: `${FLIP_OFF_PREFIX}${p.positionAddress}` }
          : { text: "Activate Flip", callback_data: `${FLIP_ON_PREFIX}${p.positionAddress}` },
      ],
    ],
  };
}

function buildHandlers(
  engine: FlipEngine,
  api: TelegramApi,
  store: StateStore,
  config: AppConfig,
): CommandHandlers {
  return {
    async onPosition(chatId: string): Promise<void> {
      const positions = await engine.listPositions();
      if (positions.length === 0) {
        await api.sendMessage(chatId, "No DLMM positions found for this wallet.");
        return;
      }
      for (const p of positions) {
        const active = engine.isActive(p.positionAddress);
        await api.sendMessage(chatId, positionMessage(p, active), positionKeyboard(p, active));
      }
    },

    async onStop(chatId: string): Promise<void> {
      const stopped = engine.stopAll();
      await api.sendMessage(chatId, `Stopped ${stopped} active flip(s). Level state is preserved.`);
    },

    async onStatus(chatId: string): Promise<void> {
      const entries = engine.status();
      if (entries.length === 0) {
        await api.sendMessage(chatId, `No active flips. Mode: ${config.dryRun ? "DRY-RUN" : "LIVE"}.`);
        return;
      }
      const lines = entries.map(
        (s) =>
          `\`${s.positionAddress}\`\nlevel ${s.lastLevel}/${config.maxSteps} · phase ${s.phase} · upperBinPrice \`${s.upperBinPrice}\` · executed [${s.executedLevels.join(",")}]`,
      );
      await api.sendMessage(chatId, `*Flips (${entries.length}) — ${config.dryRun ? "DRY-RUN" : "LIVE"}*\n${lines.join("\n")}`);
    },

    async onFlipToggle(chatId: string, messageId: number, positionAddress: string, activate: boolean): Promise<void> {
      try {
        if (activate) {
          await engine.activate(positionAddress);
        } else {
          engine.deactivate(positionAddress);
        }
        const active = engine.isActive(positionAddress);
        const positions = await engine.listPositions();
        const p = positions.find((x) => x.positionAddress === positionAddress);
        if (p) {
          await api.editMessageText(chatId, messageId, positionMessage(p, active), positionKeyboard(p, active));
        } else {
          await api.editMessageText(chatId, messageId, `\`${positionAddress}\` — flip ${active ? "ACTIVE" : "idle"} (position left the wallet)`);
        }
      } catch (err: unknown) {
        await api.sendMessage(chatId, `❌ Toggle failed for \`${positionAddress}\`:\n\`${String(err)}\``);
      }
    },
  };
}

/**
 * Dry-run level executor (FR-6.1, AC-10): decisions identical, no tx sent.
 */
function dryRunExecutor(notifier: TelegramNotifier): (exec: LevelExecution) => Promise<void> {
  return async (exec) => {
    logAction("dryRunLevelExecution", {
      positionAddress: exec.positionAddress,
      level: exec.level,
      wouldWithdraw: "ALL remaining base (X) token",
      wouldReAdd: `add to SAME position, base-side bins ${exec.minBinId}–${exec.maxBinId}`,
    });
    notifier.send(
      `🧪 *DRY-RUN level ${exec.level}*\nposition: \`${exec.positionAddress}\`\nwithdraw: ALL base token → re-add to same position, bins ${exec.minBinId}–${exec.maxBinId}`,
    );
  };
}

async function main(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) {
    logger.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (command & control runs via Telegram)");
    process.exit(1);
  }

  const notifier = new TelegramNotifier(botToken, chatId);
  const connection = getConnection();
  const wallet = loadWalletKeypair(); // fails fast if env missing
  const store = new StateStore(STATE_PATH);

  logAction("startup", {
    dryRun: config.dryRun,
    wallet: wallet.publicKey.toString(),
    telegram: true,
    persistedActive: store.activePositions.length,
  });

  const engine = new FlipEngine(
    connection,
    wallet,
    config,
    store,
    notifier,
    config.dryRun ? dryRunExecutor(notifier) : liveExecutor({ connection, wallet, config, notifier }),
  );

  // Restart recovery (FR-8.7): resume persisted active positions.
  const resumed = await engine.resumePersisted().catch((err: unknown) => {
    logger.warn({ err: String(err) }, "resumePersistedFailed");
    return 0;
  });

  notifier.send(
    `*ba_flip* started (${config.dryRun ? "DRY-RUN" : "LIVE"})\n` +
      `wallet: \`${wallet.publicKey.toString()}\`\n` +
      `resumed flips: ${resumed}\n` +
      `commands: /position · /status · /stop`,
  );

  const api = new TelegramApi(botToken, config.telegramPollTimeoutSec);
  const bot = new TelegramBot(api, chatId, buildHandlers(engine, api, store, config));
  await bot.run();
}

main().catch((err: unknown) => {
  logger.error({ err: String(err) }, "fatalError");
  process.exit(1);
});
