import { BN } from "bn.js";
import type { Connection, Keypair } from "@solana/web3.js";
import type { LevelExecution, LevelExecutor, ReverseExecution, ReverseExecutor } from "../strategy/monitor.js";
import type { AppConfig } from "../config/schema.js";
import type { TelegramNotifier } from "../notify/telegram.js";
import { loadPool } from "../dlmm/pool.js";
import { logAction } from "../logger/index.js";
import { getWalletBalanceForMint } from "../utils/solana.js";
import { signAndSend } from "./send.js";
import { planWithdrawBase, planWithdrawQuote } from "./withdraw.js";
import { planReAddBase, planReAddQuoteBidAsk, planReAddQuoteSpot } from "./readd.js";

export interface LiveExecutorDeps {
  connection: Connection;
  wallet: Keypair;
  config: AppConfig;
  notifier: TelegramNotifier;
}

/**
 * Live level executor (Fase 4, T-4.1/T-4.2): withdraw ALL remaining base-side
 * liquidity of the position, then re-add it to the SAME position over the
 * base-side bins (FR-3, FR-4.1a). Any throw aborts the level — the engine
 * stops the cycle (FR-3.6); `dryRun` is enforced upstream: this executor is
 * only ever wired when config.dryRun === false (FR-6.1).
 */
export function liveExecutor(deps: LiveExecutorDeps): LevelExecutor {
  return async (exec: LevelExecution) => {
    const { connection, wallet, config, notifier } = deps;
    const user = wallet.publicKey;
    const pool = await loadPool(connection, exec.poolAddress);
    // Re-derive fresh state: the active bin may have moved since the trigger.
    const activeBin = await pool.getActiveBin();

    // 1. Withdraw (FR-3.2/FR-3.4)
    const plan = await planWithdrawBase(pool, exec.positionAddress, user, activeBin.binId);
    if (!plan) {
      logAction("levelSkippedNoBaseLiquidity", {
        positionAddress: exec.positionAddress,
        level: exec.level,
      });
      notifier.send(
        `ℹ️ *Level ${exec.level} skipped — no base liquidity left*\nposition: \`${exec.positionAddress}\``,
      );
      return;
    }
    const withdrawSigs = await signAndSend(connection, wallet, plan.txs, {
      maxRetries: config.txMaxRetries,
    });
    logAction("withdrawSuccess", {
      positionAddress: exec.positionAddress,
      level: exec.level,
      amountX: plan.baseAmountX,
      bins: `${plan.fromBinId}-${plan.toBinId}`,
      txSignatures: withdrawSigs,
    });
    notifier.send(
      `✅ *Withdraw level ${exec.level}*\nposition: \`${exec.positionAddress}\`\namount X: \`${plan.baseAmountX}\`\nbins: ${plan.fromBinId}–${plan.toBinId}\ntx: ${withdrawSigs.map(sigLinks(exec.poolAddress)).join(", ")}`,
    );

    // 2. Re-add to the same position (FR-4.1a). Refresh state first: the tx
    // pins the active bin seen at build time and the price has been moving
    // (the withdraw itself shifts it), so a stale activeId trips error 6004.
    await pool.refetchStates();
    // Recompute the base-side range from the FRESH active bin: the price may
    // have rebounded past the withdrawn range since the withdraw, in which
    // case the old range is no longer strictly above the active bin (bins at
    // or below the active bin hold token Y, and a singleSidedX add over such
    // a range fails with token "insufficient funds").
    const freshActiveBin = await pool.getActiveBin();
    const addFromBinId = Math.max(freshActiveBin.binId + 1, plan.lowerBinId);
    if (addFromBinId > plan.upperBinId) {
      logAction("reAddSkippedPriceRebounded", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        activeBinId: freshActiveBin.binId,
        upperBinId: plan.upperBinId,
        amountX: plan.baseAmountX,
      });
      notifier.send(
        `ℹ️ *Level ${exec.level} re-add skipped — price rebounded above the position range*\nposition: \`${exec.positionAddress}\`\nactive bin: ${freshActiveBin.binId} ≥ upper bin: ${plan.upperBinId}\namount X stays in wallet: \`${plan.baseAmountX}\``,
      );
      return;
    }
    // Cap the add amount to the wallet's ACTUAL X balance: the pre-withdraw
    // estimate can exceed what removeLiquidity actually delivered (per-bin
    // rounding leaves residue), which would fail the add with token
    // "insufficient funds" on every retry.
    const requestedX = new BN(plan.baseAmountX);
    const balanceX = await getWalletBalanceForMint(connection, user, pool.tokenX.mint.address);
    const addAmountX = BN.min(requestedX, balanceX);
    if (addAmountX.isZero()) {
      logAction("reAddSkippedNoBalance", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        requestedX: plan.baseAmountX,
        balanceX: balanceX.toString(),
      });
      notifier.send(
        `ℹ️ *Level ${exec.level} re-add skipped — wallet X balance is 0*\nposition: \`${exec.positionAddress}\``,
      );
      return;
    }
    if (addAmountX.lt(requestedX)) {
      logAction("reAddAmountCapped", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        requestedX: plan.baseAmountX,
        actualX: addAmountX.toString(),
      });
      notifier.send(
        `⚠️ *Level ${exec.level} re-add capped to wallet balance*\nposition: \`${exec.positionAddress}\`\nrequested: \`${plan.baseAmountX}\`\nactual: \`${addAmountX.toString()}\``,
      );
    }
    const addTx = await planReAddBase(
      pool,
      exec.positionAddress,
      user,
      addAmountX,
      addFromBinId,
      plan.upperBinId,
      config.slippageBps,
    );
    const addSigs = await signAndSend(connection, wallet, [addTx], {
      maxRetries: config.txMaxRetries,
    });
    logAction("reAddSuccess", {
      positionAddress: exec.positionAddress,
      level: exec.level,
      amountX: addAmountX.toString(),
      bins: `${addFromBinId}-${plan.upperBinId}`,
      txSignatures: addSigs,
    });
    notifier.send(
      `✅ *Re-add level ${exec.level}*\nposition: \`${exec.positionAddress}\`\namount X: \`${addAmountX.toString()}\`\nbins: ${addFromBinId}–${plan.upperBinId}\ntx: ${addSigs.map(sigLinks(exec.poolAddress)).join(", ")}`,
    );
  };
}

/** Explorer link per signature (FR-7.6). */
function sigLinks(poolAddress: string): (sig: string) => string {
  // poolAddress captured just to keep the call site explicit about the pool;
  // explorer links are signature-based.
  void poolAddress;
  return (sig) => `[\`${sig.slice(0, 8)}…\`](https://solscan.io/tx/${sig})`;
}

/**
 * Reverse flip live executor (FR-9): withdraw ALL quote-side liquidity of the
 * position, then re-add the Y token to the SAME position — strategy from
 * config: "bidask" (all BidAsk single-sided Y) or "hybrid" (part BidAsk, part
 * Spot so Y can convert back to X when the price drops again, FR-9.3).
 * Same guards as the level executor (dryRun enforced upstream, FR-9.6).
 */
export function liveReverseExecutor(deps: LiveExecutorDeps): ReverseExecutor {
  return async (exec: ReverseExecution) => {
    const { connection, wallet, config, notifier } = deps;
    const user = wallet.publicKey;
    const pool = await loadPool(connection, exec.poolAddress);
    // Fresh state: the active bin may have moved since the trigger.
    const activeBin = await pool.getActiveBin();

    // 1. Withdraw the quote (Y) side (FR-9.2)
    const plan = await planWithdrawQuote(pool, exec.positionAddress, user, activeBin.binId);
    if (!plan) {
      logAction("reverseFlipSkippedNoQuoteLiquidity", {
        positionAddress: exec.positionAddress,
        level: exec.level,
      });
      notifier.send(
        `ℹ️ *Reverse flip level ${exec.level} skipped — no quote liquidity left*\nposition: \`${exec.positionAddress}\``,
      );
      return;
    }
    const withdrawSigs = await signAndSend(connection, wallet, plan.txs, {
      maxRetries: config.txMaxRetries,
    });
    logAction("reverseWithdrawSuccess", {
      positionAddress: exec.positionAddress,
      level: exec.level,
      amountY: plan.quoteAmountY,
      bins: `${plan.fromBinId}-${plan.toBinId}`,
      txSignatures: withdrawSigs,
    });
    notifier.send(
      `✅ *Reverse withdraw level ${exec.level}*\nposition: \`${exec.positionAddress}\`\namount Y: \`${plan.quoteAmountY}\`\nbins: ${plan.fromBinId}–${plan.toBinId}\ntx: ${withdrawSigs.map(sigLinks(exec.poolAddress)).join(", ")}`,
    );

    // 2. Re-add to the same position (FR-9.3). Refresh state first — the tx
    // pins the active bin at build time and the price keeps moving.
    await pool.refetchStates();
    const freshActiveBin = await pool.getActiveBin();
    // Quote-side range from the FRESH active bin: bins at/below it hold Y.
    // If the price dropped so far that the range vanished, skip safely.
    const addMaxBinId = Math.min(freshActiveBin.binId, plan.upperBinId);
    if (plan.lowerBinId > addMaxBinId) {
      logAction("reverseReAddSkippedPriceDroppedBelowRange", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        activeBinId: freshActiveBin.binId,
        lowerBinId: plan.lowerBinId,
        amountY: plan.quoteAmountY,
      });
      notifier.send(
        `ℹ️ *Reverse flip level ${exec.level} re-add skipped — active bin dropped below the position range*\nposition: \`${exec.positionAddress}\`\namount Y stays in wallet: \`${plan.quoteAmountY}\``,
      );
      return;
    }
    // Cap to the wallet's ACTUAL Y balance (mirrors the base-side fix:
    // per-bin rounding can leave the delivered amount below the estimate).
    const requestedY = new BN(plan.quoteAmountY);
    const balanceY = await getWalletBalanceForMint(connection, user, pool.tokenY.mint.address);
    const addAmountY = BN.min(requestedY, balanceY);
    if (addAmountY.isZero()) {
      logAction("reverseReAddSkippedNoBalance", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        requestedY: plan.quoteAmountY,
        balanceY: balanceY.toString(),
      });
      notifier.send(
        `ℹ️ *Reverse flip level ${exec.level} re-add skipped — wallet Y balance is 0*\nposition: \`${exec.positionAddress}\``,
      );
      return;
    }
    if (addAmountY.lt(requestedY)) {
      logAction("reverseReAddAmountCapped", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        requestedY: plan.quoteAmountY,
        actualY: addAmountY.toString(),
      });
      notifier.send(
        `⚠️ *Reverse flip level ${exec.level} re-add capped to wallet balance*\nposition: \`${exec.positionAddress}\`\nrequested: \`${plan.quoteAmountY}\`\nactual: \`${addAmountY.toString()}\``,
      );
    }

    const rf = config.reverseFlip;
    if (rf.strategy === "bidask") {
      const tx = await planReAddQuoteBidAsk(
        pool,
        exec.positionAddress,
        user,
        addAmountY,
        plan.lowerBinId,
        addMaxBinId,
        config.slippageBps,
      );
      const sigs = await signAndSend(connection, wallet, [tx], { maxRetries: config.txMaxRetries });
      logAction("reverseReAddSuccess", {
        positionAddress: exec.positionAddress,
        level: exec.level,
        amountY: addAmountY.toString(),
        strategy: "bidask",
        bins: `${plan.lowerBinId}-${addMaxBinId}`,
        txSignatures: sigs,
      });
      notifier.send(
        `✅ *Reverse re-add level ${exec.level} (bid-ask)*\nposition: \`${exec.positionAddress}\`\namount Y: \`${addAmountY.toString()}\`\nbins: ${plan.lowerBinId}–${addMaxBinId}\ntx: ${sigs.map(sigLinks(exec.poolAddress)).join(", ")}`,
      );
      return;
    }

    // hybrid: split the amount — part BidAsk (Y side), part Spot spanning the
    // active bin so the Y can convert back to X on the next drop (FR-9.3).
    const bidAskPct = rf.hybridBidAskPct;
    const bidAskY = addAmountY.muln(bidAskPct).divn(100);
    const spotY = addAmountY.sub(bidAskY);
    const sigs: string[] = [];
    if (!bidAskY.isZero()) {
      const tx = await planReAddQuoteBidAsk(
        pool,
        exec.positionAddress,
        user,
        bidAskY,
        plan.lowerBinId,
        addMaxBinId,
        config.slippageBps,
      );
      sigs.push(...(await signAndSend(connection, wallet, [tx], { maxRetries: config.txMaxRetries })));
    }
    if (!spotY.isZero()) {
      const tx = await planReAddQuoteSpot(
        pool,
        exec.positionAddress,
        user,
        spotY,
        plan.lowerBinId,
        addMaxBinId,
        plan.upperBinId,
        config.slippageBps,
      );
      sigs.push(...(await signAndSend(connection, wallet, [tx], { maxRetries: config.txMaxRetries })));
    }
    logAction("reverseReAddSuccess", {
      positionAddress: exec.positionAddress,
      level: exec.level,
      amountY: addAmountY.toString(),
      strategy: "hybrid",
      bidAskY: bidAskY.toString(),
      spotY: spotY.toString(),
      bins: `${plan.lowerBinId}-${addMaxBinId}`,
      txSignatures: sigs,
    });
    notifier.send(
      `✅ *Reverse re-add level ${exec.level} (hybrid)*\nposition: \`${exec.positionAddress}\`\namount Y: \`${addAmountY.toString()}\` (bid-ask \`${bidAskY.toString()}\` / spot \`${spotY.toString()}\`)\nbins: ${plan.lowerBinId}–${addMaxBinId}\ntx: ${sigs.map(sigLinks(exec.poolAddress)).join(", ")}`,
    );
  };
}
