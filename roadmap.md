# Roadmap — DLMM Meteora Auto Withdraw & Re-Add

> **Aturan update (WAJIB):**
> 1. Tandai checkbox `[ ]` → `[x]` setiap sub-task selesai.
> 2. Update kolom **Status** setiap perubahan: `pending` / `in_progress` / `done` / `blocked`.
> 3. Tambahkan entri di **Log Perubahan** di bagian bawah file ini setiap kali ada perubahan kode (tanggal, task ID, file, ringkasan).
> 4. Jika task blocked, tulis alasannya pada kolom Catatan dan tandai status `blocked`.

**Legenda Status:** ⬜ pending · 🔵 in_progress · ✅ done · ⛔ blocked

---

## Fase 0 — Riset & Keputusan

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-0.1 | ✅ ~~Konfirmasi definisi "harga -20%"~~ | **TERJAWAB (2026-11-20):** referensi = harga upper bin posisi, trigger bertingkat setiap -20% step dari upper bin (PRD Q-1) | ✅ done | |
| T-0.2 | Konfirmasi "posisi yang sama" | Jawab Q-3 PRD: bin ID absolut sama, atau offset relatif active bin | ⬜ pending | Default: offset relatif active bin |
| T-0.3 | Riset SDK DLMM bid-ask | Pelajari `StrategyType.BidAsk` / `StrategyParameters` pada `addLiquidityByStrategy`; dokumentasikan mapping bid/ask width → bin ID | ⬜ pending | |
| T-0.4 | Riset sisi token pada bin | Validasi: bin di atas/bawah active bin berisi base atau quote; konfirmasi cara withdraw hanya sisi base | ⬜ pending | |
| T-0.5 | ✅ ~~Konfirmasi metode level step~~ | **TERJAWAB (2026-11-20):** level **additive** (80%, 60%, 40% dari upper bin) + withdraw **seluruh sisa base** per level (PRD Q-2, Q-7) | ✅ done | |

### Checklist Fase 0
- [x] T-0.1 keputusan harga referensi terdokumentasi di PRD (Open Questions dijawab)
- [x] T-0.2 keputusan "posisi sama" terdokumentasi di PRD
- [x] T-0.3 hasil riset SDK bid-ask ditulis (ringkasan mapping parameter)
- [x] T-0.4 hasil validasi sisi token ditulis
- [x] T-0.5 keputusan metode level step & porsi withdraw per level terdokumentasi

---

## Fase 1 — Setup Proyek

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-1.1 | ✅ Init proyek TS | `pnpm init`, `tsconfig.json` (strict, NodeNext/ESM), struktur folder sesuai AGENTS.md | ✅ done | |
| T-1.2 | ✅ Install dependency | `@meteora-ag/dlmm@1.9.14`, `@solana/web3.js@1.99.0`, `@solana/spl-token`, `zod`, `pino`, `dotenv` | ✅ done | web3.js dipin 1.x (peer dlmm-sdk) |
| T-1.3 | ✅ Dev tooling | `vitest`, `tsx`, `typescript@5.9`; script `pnpm dev/build/test/test:watch` | ✅ done | |
| T-1.4 | ✅ `.gitignore` + `.env.example` | Ignore `.env`, `state/`, `logs/`, `dist/`; template `SOLANA_WALLET_KEY` / `WALLET_PATH` / `RPC_URL` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (tanpa nilai asli) | ✅ done | |
| T-1.5 | ✅ `config.example.json` | Template semua parameter FR-1: poolAddress, positionAddress, stepPct, maxSteps, bidAskBinRange, slippageBps, dryRun, pollIntervalMs, txMaxRetries | ✅ done | |

### Checklist Fase 1
- [x] `pnpm build` sukses pada skeleton
- [x] `pnpm test` sukses (placeholder test)
- [x] Tidak ada secret ter-commit (.env di-gitignore, .env.example tanpa nilai)
- [ ] config.example.json match zod schema (setelah T-2.1)

---

## Fase 2 — Core Infrastructure

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-2.1 | ✅ Zod schema config | `src/config/schema.ts` + `loader.ts`: validasi semua field FR-1 (base58 address, stepPct negatif, range slippage/interval), fail-fast saat startup | ✅ done | unit test 5 case |
| T-2.2 | ✅ Logger | `pino` JSONL console (+ pino-pretty saat dev); helper `logAction()` untuk event strategi | ✅ done | file transport menyusul bila perlu |
| T-2.3 | ✅ Koneksi Solana | `src/utils/solana.ts`: RPC connection dari `RPC_URL`, keypair dari `SOLANA_WALLET_KEY`/`WALLET_PATH`, validasi pubkey | ✅ done | |
| T-2.4 | ✅ State persistence | `src/state/persistence.ts`: refPrice (upperBinPrice), lastLevel, executedLevels, lock → JSON atomic write (tmp+rename); recovery saat restart (NFR-1), file korup → fresh start | ✅ done | unit test 4 case |
| T-2.5 | ✅ Wrapper pool DLMM | `src/dlmm/pool.ts`: `DLMM.create`, `getActiveBin`, binStep, tokenX/Y mint, harga active bin (pricePerToken) | ✅ done | smoke devnet menyusul di Fase 4 |
| T-2.6 | ✅ Wrapper position DLMM | `src/dlmm/position.ts`: `getPosition`, lower/upperBinId, harga upper bin (pricePerToken), `baseTokenRemaining` (sum X di bin > active, hasil T-0.4) | ✅ done | |
| T-2.7 | ✅ Notifikasi Telegram | `src/notify/telegram.ts`: Bot API `sendMessage` via fetch; no-op saat env kosong; non-blocking + retry 1x; token tidak pernah di-log | ✅ done | unit test 5 case |

### Checklist Fase 2
- [x] Unit test schema config (valid & invalid case) — 5 test lulus
- [x] Unit test state persistence (save/load/recovery) — 4 test lulus
- [x] Unit test notifier Telegram: mock fetch — terkirim saat env diset, no-op saat kosong, gagal kirim tidak throw (FR-7.4/FR-7.5) — 5 test lulus
- [ ] Wrapper pool & position teruji terhadap devnet (smoke test manual, catat hasil) — menyusul di Fase 4

---

## Fase 3 — Strategy Engine (Non-TX / Pure Logic)

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-3.1 | ✅ Price monitor | Loop polling ada di `src/index.ts` + `decide()` per tick (interval dari config); implementasi loop penuh saat integrasi Fase 4 | ✅ done | pure logic siap |
| T-3.2 | ✅ Level step evaluator | `src/strategy/engine.ts`: `levelPrice`/`evaluateLevel` additive dari upper bin (Decimal, no float); unit test: batas tepat -20%, multi-level skip, noise harga, idempotent | ✅ done | 7 test case |
| T-3.3 | ✅ Kalkulator distribusi bid-ask | `src/strategy/engine.ts`: `bidAskRange` = offset relatif active bin (keputusan T-0.2); unit test boundary | ✅ done | distribusi amount ditangani SDK `StrategyType.BidAsk` (rentang tunggal) |
| T-3.4 | ✅ State machine siklus per level | `src/strategy/cycle.ts`: IDLE→TRIGGERED→WITHDRAWING→RE_ADDING→DONE→IDLE; illegal transition throw; lock+lastLevel persist; `src/strategy/decide.ts` keputusan per tick | ✅ done | 11 test case (FR-3.3, FR-5.2) |
| T-3.5 | ✅ Batas maxSteps | `decide()` → `MAX_STEPS_EXCEEDED` (monitor jalan terus, alert via notif); `evaluateLevel` null di luar maxSteps | ✅ done | FR-6.2 |
| T-3.6 | ✅ triggerMode binPct | `triggerMode` config (`pricePct` default \| `binPct`); mode binPct: `stepBinCount`/`levelBinId`/`evaluateLevelByBin` di engine.ts, branch di `decide()`, wiring monitor; trigger = persentase lebar bin posisi, evaluasi integer bin ID (FR-3.1b, Q-11) | ✅ done | 15 test baru (total 59) |

### Checklist Fase 3
- [x] Unit test level evaluator (case: -19.99%, -20.00%, -20.01%, harga naik, skip level 1→3 sekaligus, level sudah dieksekusi)
- [x] Unit test mode binPct: stepBinCount (exact/floor/clamp), threshold bin tepat, idempotent, maxSteps (T-3.6)
- [x] Unit test distribusi bid-ask (offset bin, boundary bin ID)
- [x] Unit test state machine (double-trigger ditolak, crash-recovery state, idempotent per level)
- [ ] Dry-run end-to-end: harga disimulasikan → keputusan withdraw+re-add per level benar (AC-7) — integrasi di Fase 4

---

## Fase 4 — Eksekusi Transaksi (Jalur Uang Riil)

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-4.1 | ✅ Withdraw base token | `src/tx/withdraw.ts`: `planWithdrawBase` — `removeLiquidity` 100% (bps 10000) range `max(activeBinId+1, lowerBinId)` s/d `upperBinId`, `shouldClaimAndClose: false`; null saat tidak ada sisa base (FR-3.4, T-0.5) | ✅ done | unit test 4 case; smoke devnet di T-4.6 |
| T-4.2 | ✅ Re-add bid-ask | `src/tx/readd.ts`: `planReAddBase` — `addLiquidityByStrategy` BidAsk + `singleSidedX: true` ke posisi yang sama (FR-4.1a); slippage dari config (bps → persen SDK) | ✅ done | unit test 1 case; smoke devnet di T-4.6 |
| T-4.3 | ✅ Retry & error handling tx | `src/tx/send.ts`: `signAndSend` — sign wallet, kirim + konfirmasi berurutan, retry `txMaxRetries` + backoff linear; gagal total → throw → engine stop siklus (FR-3.6) | ✅ done | unit test 4 case |
| T-4.4 | ✅ Integrasi state machine ↔ tx | `src/tx/live.ts`: `liveExecutor` — re-fetch pool/active bin fresh, withdraw → re-add; wiring di `src/index.ts` (hanya saat `dryRun:false`, FR-6.1); monitor: gagal total → deactivate posisi (stop siklus, level tidak ditandai executed) | ✅ done | unit test 3 case; dry-run path tidak tersentuh |
| T-4.5 | ✅ Log aksi strategi + notif Telegram | `logAction` JSONL per event (withdrawSuccess/reAddSuccess/levelSkippedNoBaseLiquidity + tx signature); notif Telegram sukses per tx + link explorer solscan (FR-5.3, FR-7.1, FR-7.6) | ✅ done | via notifier existing |
| T-4.6 | Uji devnet end-to-end | Pool & position devnet; jalankan siklus minimal 2 level; verifikasi level tidak dieksekusi ganda & restart aman (AC-3 s/d AC-6) | ⬜ pending | |
| T-4.7 | Uji notifikasi Telegram live | Set env Telegram pada devnet run; verifikasi semua event FR-7.1 sampai ke HP & Telegram error tidak mengganggu siklus (AC-10) | ⬜ pending | |

### Checklist Fase 4
- [x] Withdraw/re-add logic teruji unit (mock SDK) — 12 test baru (total 71)
- [ ] Withdraw devnet sukses + tx signature tercatat (T-4.6)
- [ ] Re-add bid-ask devnet sukses; bin position terverifikasi di explorer
- [ ] Level kedua dieksekusi hanya setelah level pertama selesai
- [ ] Dry-run TIDAK mengirim transaksi apa pun (verifikasi log)
- [ ] Retry path teruji (simulasi error RPC)
- [ ] lastLevel ter-persist & tidak eksekusi ulang setelah restart (cek state file)
- [ ] Notifikasi Telegram diterima untuk setiap event strategi saat devnet run

---

## Fase 5 — Hardening & Rilis v1

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-5.1 | Guard minimum balance | Cek balance hasil withdraw ≥ minimum sebelum add; skip + log jika kurang (FR-6.3) | ⬜ pending | |
| T-5.2 | Auto-reconnect RPC | Handle disconnect/rate limit; reconnect dengan backoff (NFR-1) | ⬜ pending | |
| T-5.3 | Audit keamanan | Review: tidak ada key di log, .env ter-ignore, verify address sebelum tx (NFR-3) | ⬜ pending | |
| T-5.4 | README penggunaan | Cara set config, set env (wallet, RPC, Telegram), jalankan, stop, baca log (AC-9) | ⬜ pending | |
| T-5.5 | Go-live mainnet-beta | Migrasi config ke mainnet, jumlah kecil dulu, monitor 1 level penuh manual | ⬜ pending | Perlu persetujuan user |

### Checklist Fase 5
- [ ] Semua AC di PRD section 10 terpenuhi
- [ ] Audit keamanan pass
- [ ] README lengkap
- [ ] Persetujuan user untuk go-live mainnet

---

## Fase 6 — Telegram Command & Control (Desain v0.4)

> Perubahan arsitektur: kontrol via command Telegram (`/position`, `/stop`, `/status`), discovery posisi dari wallet, monitoring multi-posisi paralel. Lihat PRD v0.4 (FR-2, FR-8, Q-6/Q-8/Q-9).

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-6.1 | ✅ Riset SDK list posisi user | **Hasil:** `DLMM.getAllLbPairPositionsByUser(connection, userPubKey)` → `Map<lbPair, PositionInfo>` dengan `lbPairPositionsData: LbPosition[]`; didokumentasikan di PRD §7 | ✅ done | |
| T-6.2 | ✅ Rework config schema | Hapus `poolAddress`/`positionAddress`; schema jadi `z.strictObject` (tolak key legacy); tambah `telegramPollTimeoutSec` (5–50, default 30); `config.example.json` + unit test di-update | ✅ done | 6 test case |
| T-6.3 | ✅ Bot Telegram getUpdates loop | `src/telegram/api.ts` (client Bot API: sendMessage/editMessageText/answerCallbackQuery/getUpdates, error poll tidak mematikan loop) + `src/telegram/bot.ts` (dispatch command & callback, whitelist `TELEGRAM_CHAT_ID`, prefix `flip_on:`/`flip_off:`); unit test dispatch & whitelist (mock api) | ✅ done | 5 test case |
| T-6.4 | ✅ Command `/position` | Handler di `src/index.ts`: fetch posisi wallet → **1 pesan per posisi** (pair, bins, upperBinPrice, amounts, status) + inline button toggle Activate/Deactivate Flip | ✅ done | |
| T-6.5 | ✅ Command `/stop` & `/status` | `/stop` → `engine.stopAll()`; `/status` → ringkasan per posisi aktif (level, phase, executedLevels, upperBinPrice) | ✅ done | |
| T-6.6 | ✅ Engine multi-posisi | `src/strategy/monitor.ts`: `FlipEngine` — registry posisi aktif, monitor loop paralel per posisi, pool cache shared, refPrice per posisi (refresh saat upper bin berubah), resume persisted, executor pluggable (dry-run default; live = stub error sampai Fase 4) | ✅ done | guard double-execution per posisi via CycleStateMachine |
| T-6.7 | ✅ State per posisi + recovery | `src/state/persistence.ts` rework: `StateFile { activePositions, positions keyed by address }` + `StateStore` (toggle idempotent, deactivateAll, atomic write); `CycleStateMachine` pakai shared store; fix shared-reference bug; unit test 7 case | ✅ done | |
| T-6.8 | ✅ Integrasi bot ↔ engine ↔ executor | `src/index.ts`: wiring lengkap — bot ↔ handlers ↔ FlipEngine ↔ executor; `dryRun` global dihormati semua path; env Telegram wajib (fail-fast); notif event tetap via notifier FR-7 | ✅ done | live executor stub menunggu Fase 4 |
| T-6.9 | Uji end-to-end C&C | Devnet/dry-run: `/position` → activate 2 posisi → simulasi level → verifikasi withdraw+re-add per posisi, `/stop`, restart recovery, chat non-whitelist diabaikan (AC-1 s/d AC-11) | ⬜ pending | perlu wallet + bot token user |

### Checklist Fase 6
- [x] Command dari chat di luar whitelist diabaikan + ter-log (unit test)
- [x] `/position` menampilkan semua posisi wallet, 1 pesan per posisi + button (implementasi; verifikasi live di T-6.9)
- [x] Toggle activate/deactivate idempotent & ter-persist (unit test)
- [x] Multi-posisi paralel: guard per posisi teruji, tidak saling ganggu (unit test isolation)
- [ ] Restart: posisi aktif dilanjutkan otomatis, level tidak dieksekusi ulang — kode ada (`resumePersisted`), verifikasi live di T-6.9
- [x] dryRun=true: tidak ada transaksi terkirim dari jalur Telegram (executor dry-run; live = stub error)

---

## Fase 7 — Reverse Flip / Loop Adaptif (PRD v0.6, FR-9)

> Fitur user (2026-11-22): saat harga pulih melewati threshold level yang sudah dieksekusi, withdraw sisi quote (Y) → re-add ke posisi sama (bidask/hybrid), level di-rollback sehingga flip bisa loop 1→2→1→2→3→2 dst.

| ID | Task | Detail | Status | Catatan |
|----|------|--------|--------|---------|
| T-7.1 | ✅ Desain & dokumen | PRD v0.6: FR-9 (trigger reverse, strategi re-add bidask/hybrid, rollback level, guard per episode, config) + Q-12 terjawab | ✅ done | |
| T-7.2 | ✅ Config reverse flip | `reverseFlip: { enabled, strategy (bidask\|hybrid), hybridBidAskPct }` di zod schema + config.example.json | ✅ done | backwards-compat state file |
| T-7.3 | ✅ Pure logic reverse | `evaluateReverse`/`evaluateReverseByBin` (strict recovery di atas threshold lastLevel); branch `REVERSE_LEVEL` di `decide()` (kedua triggerMode) | ✅ done | unit test reverse.test.ts |
| T-7.4 | ✅ State machine + persist | `lastReversedLevel` di PositionState (migrasi otomatis state lama); `completeReverse` (rollback level + guard) + `clearReverseGuard` saat level re-trigger | ✅ done | |
| T-7.5 | ✅ Engine monitor | Handle `REVERSE_LEVEL` di `FlipEngine.tick()` (lock, notif, log, rollback, stop-on-fail); `ReverseExecutor` pluggable (dry-run + live) | ✅ done | |
| T-7.6 | ✅ Live reverse executor | `planWithdrawQuote` (removeLiquidity 100% sisi quote, refetch + cap balance, skip aman), re-add `planReAddQuoteBidAsk` (single-sided Y) / hybrid `planReAddQuoteSpot` (Spot via rentang quote + active bin) | ✅ done | SDK: depositOnlyY path via range di bawah active bin |
| T-7.7 | ✅ Unit test | 17 test baru: evaluator reverse (bin/price), decide branch, guard FR-9.5, rollback FR-9.4, engine loop penuh (trigger→reverse→re-trigger) | ✅ done | total 98 test lulus |
| T-7.8 | Uji devnet reverse flip | Jalankan siklus: level trigger → simulasi rebound → verifikasi withdraw Y + re-add + rollback state + loop berulang | ⬜ pending | gabung dengan T-4.6 |

### Checklist Fase 7
- [x] Reverse trigger teruji unit (bin & price mode, strict boundary)
- [x] Guard double-reverse per episode (FR-9.5)
- [x] Rollback level + re-trigger level yang sama (FR-9.4)
- [x] dryRun: reverse executor hanya log/notif, tanpa tx
- [x] Live path: withdraw quote + re-add bidask/hybrid (mock SDK)
- [ ] Devnet end-to-end reverse flip (T-7.8)

---

## Log Perubahan

> Format: `YYYY-MM-DD | Task ID | File yang diubah | Ringkasan perubahan`

| Tanggal | Task ID | File | Ringkasan |
|---------|---------|------|-----------|
| 2026-11-20 | — | PRD.md, AGENTS.md, roadmap.md | Inisialisasi dokumen: PRD, panduan agent, roadmap tugas |
| 2026-11-20 | T-0.1 | PRD.md, roadmap.md, AGENTS.md | Koreksi strategi dari user: referensi harga = **harga upper bin posisi** (fixed), trigger bertingkat **setiap -20% step** dari upper bin (bukan anchor per siklus); PRD naik v0.2, update FR-2/FR-3/FR-5, flow, AC, task Fase 0/2/3/4 |
| 2026-11-20 | T-0.5 | PRD.md, roadmap.md | Konfirmasi user: level step **additive** (80/60/40%) + withdraw **seluruh sisa base** per level; PRD Q-2 & Q-7 terjawab, FR-3.1 dikonfirmasi |
| 2026-11-20 | — | PRD.md, AGENTS.md, roadmap.md | Tambah fitur **notifikasi Telegram** (permintaan user): PRD v0.3 dengan FR-7 (event, env-based, non-blocking), tech stack, flow diagram, AC-10; task baru T-2.7 & T-4.7, update T-1.4/T-4.5/T-5.4 |
| 2026-11-20 | T-0.2 | PRD.md, roadmap.md | Konfirmasi user: "posisi sama" = **offset relatif active bin** saat trigger, width dari `bidAskBinRange`; PRD Q-3 terjawab, FR-4.1 diupdate |
| 2026-11-20 | T-0.3, T-0.4 | PRD.md, roadmap.md, AGENTS.md | Riset SDK selesai: package = `@meteora-ag/dlmm`; `StrategyType.BidAsk` dengan rentang tunggal min/maxBinId; bin atas active = X (base), bawah = Y (quote); `removeLiquidity` range-based (`fromBinId`/`toBinId`/`bps`); hasil riset didokumentasikan di PRD §7 |
| 2026-11-20 | T-1.1–T-1.5 | package.json, tsconfig.json, .gitignore, .env.example, config.example.json, src/index.ts, tests/ | Fase 1 setup: proyek TS strict ESM, deps (`@meteora-ag/dlmm@1.9.14`, web3.js 1.x, zod, pino, vitest), script dev/build/test, template env & config; `pnpm build` + `pnpm test` lulus |
| 2026-11-20 | T-2.1–T-2.7 | src/config/, src/logger/, src/utils/solana.ts, src/state/persistence.ts, src/dlmm/pool.ts, src/dlmm/position.ts, src/notify/telegram.ts, tests/ (config/state/notify) | Fase 2 core infrastructure: zod config fail-fast, pino logger + logAction, RPC+keypair env loader, state persistence atomic + recovery, wrapper pool/position DLMM, notifier Telegram non-blocking; 14 unit test lulus |
| 2026-11-20 | T-3.1–T-3.5 | src/strategy/engine.ts, src/strategy/cycle.ts, src/strategy/decide.ts, tests/strategy/ | Fase 3 strategy engine: evaluator level additive (Decimal), bidAskRange offset active bin, state machine siklus + guard double-execution + persist, decide() dengan maxSteps guard; 21 unit test lulus (total 35) |
| 2026-11-20 | — | PRD.md, roadmap.md | **Perubahan desain v0.4 (permintaan user):** kontrol via **Telegram command** — `/position` (daftar posisi wallet, 1 pesan/posisi + button Activate Flip), `/stop`, `/status`; posisi di-discover dari wallet (private key `.env`), monitoring **multi-posisi paralel**; `poolAddress`/`positionAddress` dihapus dari config; whitelist chat `TELEGRAM_CHAT_ID`; dryRun global dari config. PRD: FR-1/FR-2 rework, FR-8 baru, Q-6/Q-8/Q-9 terjawab, flow & AC di-update. Roadmap: Fase 6 baru (T-6.1–T-6.9), catatan rework T-2.1/T-2.4/T-4.4 |
| 2026-11-20 | T-6.1–T-6.8 | src/telegram/api.ts, src/telegram/bot.ts, src/strategy/monitor.ts, src/strategy/cycle.ts, src/state/persistence.ts, src/dlmm/position.ts, src/config/schema.ts, src/index.ts, config.example.json, tests/ (config/state/strategy/telegram) | **Implementasi Fase 6 (T-6.1–T-6.8):** riset SDK list posisi (`getAllLbPairPositionsByUser`); config strict tanpa pool/position address + `telegramPollTimeoutSec`; bot Telegram long-polling (whitelist, dispatch command/callback, editMessageText); command `/position` (1 pesan/posisi + button toggle), `/stop`, `/status`; `FlipEngine` multi-posisi (monitor paralel, pool cache, refPrice per posisi, resumePersisted, executor pluggable — dry-run default, live stub error); `StateStore` multi-posisi (toggle idempotent, atomic write; fix shared-reference bug pada freshState); wiring penuh di index.ts. 44 unit test lulus, build sukses |
| 2026-11-20 | — | PRD.md, roadmap.md, src/strategy/decide.ts, src/strategy/engine.ts, src/config/schema.ts, src/strategy/monitor.ts, src/index.ts, config.example.json, tests/ | **Keputusan desain (a) re-add ke posisi lama (Q-10, konfirmasi user):** base token di-add kembali ke position address yang sama pada bin sisi base posisi (`max(activeBinId+1, lowerBinId)` s/d `upperBinId`), tanpa posisi baru; `bidAskBinRange` & fungsi `bidAskRange` dihapus dari config/schema/engine; `decide()` kini menerima `lowerBinId`/`upperBinId` posisi; PRD FR-4.1/FR-4.2 + Q-10 di-update. 44 test lulus, build sukses |
| 2026-11-20 | T-3.6 | src/config/schema.ts, src/strategy/engine.ts, src/strategy/decide.ts, src/strategy/monitor.ts, config.example.json, PRD.md, roadmap.md, tests/ (config/strategy) | **Fitur `triggerMode: "binPct"` (Q-11, permintaan user):** step dihitung dari persentase **lebar bin posisi** (`stepBinCount` = floor(width × \|stepPct\|/100), min 1), trigger dievaluasi pada bin ID (`evaluateLevelByBin`: `activeBinId ≤ upperBinId − N × stepBins`) tanpa konversi harga; `triggerMode` config default `pricePct` (perilaku lama FR-3.1 tidak berubah); notif/log level kini menyertakan threshold bin di mode binPct; guard idempotent & maxSteps berlaku sama. 15 test baru (total 59) lulus, build sukses |
| 2026-11-20 | T-4.1–T-4.5 | src/tx/withdraw.ts, src/tx/readd.ts, src/tx/send.ts, src/tx/live.ts, src/dlmm/sdk.ts, src/strategy/monitor.ts, src/index.ts, tests/tx/ (withdraw/readd/send/live) | **Implementasi Fase 4 jalur uang riil:** `planWithdrawBase` (removeLiquidity 100% sisi base, bps 10000, shouldClaimAndClose false), `planReAddBase` (addLiquidityByStrategy BidAsk singleSidedX ke posisi sama, slippage bps→persen), `signAndSend` (sign+send+confirm berurutan, retry txMaxRetries + backoff linear), `liveExecutor` (re-fetch active bin fresh → withdraw → re-add → log JSONL + notif Telegram dengan tx signature/link solscan); monitor: gagal total level → deactivate posisi (stop siklus FR-3.6, level tidak ditandai executed); stub live executor dihapus. 12 unit test baru (total 71) lulus, build sukses. T-4.6/T-4.7 (uji devnet live) masih pending |
| 2026-11-20 | — | src/telegram/api.ts, src/telegram/bot.ts | **Fix (laporan user): command bot tidak tampil di menu autocomplete Telegram.** Tambah `setMyCommands` di `TelegramApi` + dipanggil best-effort saat `TelegramBot.run()` start (register `/position`, `/status`, `/stop`; gagal hanya log warn, tidak mematikan loop). Build + 71 test lulus |
| 2026-11-20 | T-3.5, T-6.6 | src/strategy/monitor.ts, tests/strategy/monitor.test.ts | **Fix (laporan user): notif "maxSteps exceeded" terkirim berulang setiap poll.** Tambah flag `maxStepsAlerted` per monitor — alert dikirim hanya 1x per episode (harga di bawah limit); flag di-reset saat harga pulih ke atas limit (MONITOR), sehingga alert baru hanya muncul jika harga turun lagi. 2 unit test baru (total 73) lulus, build sukses |
| 2026-11-20 | T-4.1, T-4.2 | src/tx/live.ts, src/tx/readd.ts, tests/tx/live.test.ts, tests/tx/readd.test.ts | **Fix (laporan user): re-add gagal error 6004 `ExceededBinSlippageTolerance` pada `AddLiquidityByStrategy2`.** Akar masalah: SDK menghitung toleransi sebagai `ceil(slippagePct / binStepPct)` **bin** — dengan slippage 1% dan binStep kasar, toleransi hanya ~1 bin, dan active bin bergeser saat harga turun cepat / setelah withdraw. Fix: (1) `pool.refetchStates()` sebelum build tx re-add agar `activeId` segar; (2) slippage efektif diperlebar hingga menutup minimal 10 bin pergerakan active bin (`MIN_BIN_SLIPPAGE_COVERAGE`), tetap ≥ slippage config. Test mock diupdate; 73 test lulus, build sukses |
| 2026-11-20 | T-4.2 | src/tx/live.ts, src/tx/withdraw.ts, tests/tx/live.test.ts | **Fix (kronologi user, lanjutan Level 8): saat re-add harga sudah rebounce melewati range yang di-withdraw.** Range re-add sebelumnya dipakai mentah dari plan withdraw (`max(activeBin+1, lowerBinId)..upperBinId`) — jika active bin sudah naik kembali, bin tersebut tidak lagi berada di atas active bin (bin ≤ active memegang token Y), sehingga `addLiquidityByStrategy singleSidedX` gagal token `insufficient funds` di setiap retry. Fix: setelah `refetchStates()`, **recompute range re-add dari active bin fresh** (`max(freshActiveBin+1, position.lowerBinId)..upperBinId`, `lowerBinId`/`upperBinId` posisi kini disimpan di `WithdrawPlan`); bila harga rebound hingga `freshActiveBin+1 > upperBinId` → skip re-add aman (`reAddSkippedPriceRebounded`, X tetap di wallet) + notif Telegram. 2 test baru (total 81) lulus, build sukses |
| 2026-11-20 | T-4.2 | src/tx/live.ts, src/utils/solana.ts, tests/tx/live.test.ts, tests/utils/solana.test.ts | **Fix (laporan user): Level 8 gagal — flip STOPPED, `Error processing Instruction 2: custom program error: 0x1` (token `TransferChecked: insufficient funds`).** Akar masalah: re-add memakai `baseAmountX` hasil estimasi data posisi **sebelum** withdraw, sedangkan `removeLiquidity(bps 10000)` bisa menghasilkan X nyata sedikit lebih kecil (pembulatan per-bin menyisakan residu) → `TransferChecked` dari ATA wallet gagal insufficient funds dan semua retry gagal (tx statis). Fix: setelah withdraw terkonfirmasi, baca saldo X ATA wallet nyata (`getWalletTokenBalance`, u64 LE offset 64, ambil akun terbesar, 0 jika tidak ada) dan **cap** jumlah re-add ke `min(requested, balance)`; log + notif `reAddAmountCapped` bila terpotong, skip aman bila saldo 0 (`reAddSkippedNoBalance`). 6 test baru (total 79) lulus, build sukses |
| 2026-11-22 | T-7.1–T-7.7 | PRD.md, roadmap.md, config.example.json, src/config/schema.ts, src/strategy/engine.ts, src/strategy/decide.ts, src/strategy/cycle.ts, src/strategy/monitor.ts, src/state/persistence.ts, src/dlmm/position.ts, src/tx/withdraw.ts, src/tx/readd.ts, src/tx/live.ts, src/index.ts, tests/strategy/ (reverse/monitor) | **Fitur reverse flip / loop adaptif (PRD v0.6, FR-9):** trigger reverse saat harga/active bin pulih **strictly di atas** threshold `lastLevel` (`evaluateReverse`/`evaluateReverseByBin`, kedua triggerMode); withdraw 100% sisi quote (`planWithdrawQuote` range `lowerBinId..min(activeBinId, upperBinId)`) → re-add ke posisi sama: strategi `bidask` (BidAsk single-sided Y) atau `hybrid` (`hybridBidAskPct`% bid-ask Y, sisanya Spot melintasi active bin agar Y bisa konversi balik ke X saat harga turun); **rollback level** (`completeReverse`: lastLevel−1, level dihapus dari executedLevels, guard `lastReversedLevel` per episode FR-9.5, guard di-clear saat level re-trigger) → loop 1→2→1→2→3→2…; config `reverseFlip {enabled, strategy, hybridBidAskPct}`; state lama di-migrasi otomatis; guard live path sama seperti level executor (refetch, cap balance, skip aman, dryRun, stop-on-fail). 17 test baru (total 98) lulus, build sukses |
| 2026-11-22 | T-7.6 | src/utils/solana.ts, src/tx/live.ts, tests/utils/solana.test.ts, tests/tx/live.test.ts | **Fix (laporan user): reverse flip re-add skipped — "wallet Y balance is 0".** Akar masalah: tokenY pool = **wSOL**; Meteora `removeLiquidity` otomatis **unwrap wSOL → native SOL** (wallet bahkan tidak punya wSOL ATA), sehingga `getWalletTokenBalance` (baca token account) membaca 0 padahal Y sudah masuk sebagai lamports. Fix: helper `getWalletBalanceForMint` — mint wSOL → baca `getBalance` native minus **fee reserve 0.01 SOL**; dipakai di jalur base & reverse executor. 3 test baru (total 101) lulus, build sukses |
