# PRD — DLMM Meteora Auto Withdraw & Re-Add (Bid-Ask Flip Strategy)

> Status: Draft v0.4 · Dibuat: 2026-11-20 · Owner: Anda · Target: Internal trading tool
> Changelog: v0.2 — referensi harga diubah dari anchor per siklus menjadi **harga upper bin posisi**, trigger menjadi **bertingkat setiap -20% step** dari upper bin.
> Changelog: v0.3 — tambah **FR-7 notifikasi Telegram** (Bot API via fetch, env-based, non-blocking).
> Changelog: v0.4 — **perubahan arsitektur besar**: kontrol via **Telegram command** (`/position` → daftar posisi wallet + button *Activate Flip*, `/stop`, `/status`); posisi di-discover dari **wallet** (bukan config), monitoring **multi-posisi paralel** per posisi yang di-activate; `poolAddress`/`positionAddress` dihapus dari config.
> Changelog: v0.5 — tambah config `triggerMode` (`pricePct` default | `binPct`): mode **binPct** menentukan step sebagai persentase dari **lebar bin posisi** (`stepBins = floor(width × |stepPct| / 100)`), trigger dievaluasi pada bin ID (integer) — menjawab Q-11.
> Changelog: v0.6 — tambah **FR-9 reverse flip (loop adaptif)**: saat harga pulih kembali melewati threshold level yang sudah dieksekusi, withdraw sisi quote (Y) dari bin posisi, lalu re-add ke posisi yang sama dengan strategi `bidask` atau `hybrid` (50% bid-ask Y / 50% spot) — menjawab Q-12.
> Changelog: v0.7 — tambah **FR-10 sweep validation**: trigger harus bertahan N poll berturut-turut sebelum eksekusi (`sweepValidation.confirmations`, default 2) agar wick/sweep sesaat tidak memicu withdraw/re-add.

---

## 1. Latar Belakang

Meteora DLMM (Dynamic Liquidity Market Maker) memungkinkan LP menempatkan likuiditas pada rentang bin tertentu di sekitar harga aktif. Posisi LP pada sisi **Base token** sangat rentan terhadap penurunan harga: ketika harga turun, base token yang dijadikan likuiditas akan *rugi tidak permanen* dan nilainya ikut turun.

Tools ini dibuat untuk memitigasi risiko tersebut secara otomatis:

1. Membaca **posisi DLMM** yang ada (rentang bin posisi → **upper bin** sebagai harga referensi).
2. Memantau harga aktif pool; setiap kali harga turun **-20% step dari harga upper bin** (level bertingkat: -20%, -40%, -60%, dst), tools melakukan:
   - **Withdraw** likuiditas sisi Base token dari posisi.
   - **Re-add** base token tersebut ke pool dengan **strategi Bid-Ask** pada posisi bin yang sama (*bid-ask and flip*), sehingga token tetap produktif menghasilkan fee sambil menunggu pemulihan harga.

**Alur besar:** user kirim command Telegram → daftar posisi wallet → activate flip per posisi → monitor harga pool posisi tsb → cek penurunan dari upper bin → withdraw + add liquidity setiap -20% dari upper bin.

**Interaksi (v0.4):** tools dijalankan sebagai **bot Telegram**. User memicu `/position`, bot membalas **1 chat per posisi** milik wallet (private key dari `.env`) lengkap dengan button **Activate Flip**. Hanya posisi yang di-activate yang dipantau (multi-posisi paralel).

---

## 2. Tujuan (Goals)

- **G1** — Menemukan posisi DLMM milik wallet secara otomatis dan memantau harga pool (active bin) untuk posisi yang di-activate.
- **G2** — Menarik (withdraw) likuiditas sisi Base token secara otomatis **setiap kali harga turun -20% step dari harga upper bin posisi** (level bertingkat).
- **G3** — Menambahkan kembali (re-add) base token dengan strategi **bid-ask** pada posisi bin yang sama dengan posisi sebelumnya.
- **G4** — Menjalankan siklus *withdraw → re-add* berulang (flip) dengan aman, tercatat, dan dapat diaudit.
- **G5** — Memberi kontrol penuh kepada user lewat **command Telegram** (`/position`, `/stop`, `/status`) + parameter strategi via config file (threshold, rentang bin, mode dry-run, dll).

## 3. Non-Goals (di luar scope v1)

- Trading otomatis multi-pool bersamaan (v1: satu pool per konfigurasi).
- Manajemen quote token / hedging.
- Backtesting historis.
- Dashboard GUI / web interface (v1: Telegram bot + logging).
- Strategi grid kompleks lain di luar bid-ask flip pada posisi yang sama.
- Validasi command dari chat lain di luar whitelist (langsung diabaikan, FR-8.2).

---

## 4. User Stories

| ID | Sebagai | Saya ingin | Sehingga |
|----|---------|-----------|----------|
| US-1 | LP holder | Tools memantau harga pool posisi yang saya activate secara kontinu | Saya tidak perlu pantau manual |
| US-2 | LP holder | Withdraw base token otomatis setiap harga turun 20% step dari upper bin posisi saya | Kerugian saya terpotong bertahap sebelum makin dalam |
| US-3 | LP holder | Base token yang ditarik langsung di-re-add dengan bid-ask di posisi bin yang sama | Token tetap menghasilkan fee & flip, bukan idle di wallet |
| US-4 | LP holder | Melihat riwayat aksi (log) setiap withdraw/re-add | Saya bisa audit keputusan tools |
| US-5 | LP holder | Mode dry-run / simulasi | Saya bisa validasi strategi tanpa risiko dana |
| US-6 | LP holder | Mengubah threshold & parameter via config file | Fleksibel tanpa ubah kode |
| US-7 | LP holder | Kirim `/position` di Telegram dan lihat semua posisi wallet, 1 pesan per posisi | Saya bisa pilih posisi mana yang mau di-flip tanpa set address manual |
| US-8 | LP holder | Tekan button *Activate Flip* pada posisi tertentu | Monitoring + eksekusi strategi mulai hanya untuk posisi yang saya pilih |
| US-9 | LP holder | Command `/stop` dan `/status` | Saya bisa menghentikan semua flip dan melihat progres level per posisi dari HP |

---

## 5. Functional Requirements

### FR-1 Konfigurasi (Config)
- FR-1.1 Parameter **strategi** berada di file config (JSON): `stepPct` (default `-20`), `triggerMode` (`"pricePct"` default | `"binPct"`), `maxSteps` (mis. `5`), `slippageBps`, `dryRun`, `pollIntervalMs`, `txMaxRetries`, dll. `poolAddress`/`positionAddress` **TIDAK lagi di config** — posisi di-discover dari wallet (FR-2.1) dan dipilih via Telegram (FR-8).
- FR-1.2 Validasi config saat startup; tolak nilai tidak valid (step 0, dll).
- FR-1.3 `dryRun` bersifat **global** (dari config); semua jalur transaksi mematuhinya, tidak ada bypass dari Telegram.

### FR-2 Discovery Posisi & Monitoring Harga
- FR-2.1 Posisi DLMM di-discover dari **wallet** (pubkey derived dari `SOLANA_WALLET_KEY` / `WALLET_PATH` env) — semua posisi DLMM milik wallet diambil via SDK saat command `/position` diterima (fetch fresh, tanpa cache).
- FR-2.2 Monitoring harga hanya berjalan untuk posisi berstatus **active flip** (di-activate via button), **multi-posisi paralel**, masing-masing dengan state machine & lock sendiri.
- FR-2.3 Per posisi aktif: rentang bin (`lowerBinId`–`upperBinId`) dibaca; **harga upper bin posisi = harga referensi** (`refPrice`, dihitung dari `binStep` pool). Referensi **fixed** selama siklus posisi tsb berjalan, di-refresh saat activate/restart jika posisi berubah di chain.
- FR-2.4 Tools subscribe harga pool DLMM via RPC (polling) pada interval dari config (default ~5 detik), per pool dari posisi aktif (pool sama bisa dishare antar posisi).
- FR-2.5 Status posisi (harga saat ini, % terhadap upper bin, level tercapai, bin aktif) dapat dilihat via `/status`.

### FR-3 Trigger Withdraw (Level Bertingkat dari Upper Bin)
- FR-3.1 Mode `triggerMode: "pricePct"` (default): tools menghitung level trigger bertingkat dari harga upper bin (**additive**): `levelN = upperBinPrice × (1 + stepPct × N)` dengan N = 1, 2, 3, ... (step -20% → level pada 80%, 60%, 40%, ... dari harga upper bin).
- FR-3.1b Mode `triggerMode: "binPct"` (v0.5, Q-11): step dihitung dari **lebar bin posisi**: `stepBins = floor((upperBinId − lowerBinId) × |stepPct| / 100)` (min 1); level N tercapai saat `activeBinId ≤ upperBinId − N × stepBins`. Evaluasi murni integer bin ID, tanpa konversi harga. Contoh: posisi 60 bin, step -20% → 12 bin per step → flip di bin ke-12, -24, -36, -48, -60 dari upper bin (5 level tepat sampai lower bound). Aturan idempotent (FR-3.3) dan maxSteps (FR-6.2) sama berlaku untuk kedua mode.
- FR-3.2 Setiap kali harga aktif **pertama kali menyentuh/melewati** level berikutnya (dan level sebelumnya belum dieksekusi), eksekusi withdraw **seluruh sisa sisi Base token** dari posisi.
- FR-3.3 Setiap level hanya boleh dieksekusi **satu kali** (idempotent per level, termasuk setelah restart — level yang sudah dieksekusi persist di state).
- FR-3.4 Withdraw hanya menarik sisi base; sisi quote (jika ada) tidak disentuh.
- FR-3.5 Menggunakan `removeLiquidity` Meteora DLMM SDK dengan parameter bin yang sesuai.
- FR-3.6 Retry maksimal N kali (configurable) dengan backoff; gagal total → hentikan siklus + alert.

### FR-4 Re-Add Bid-Ask (Posisi Sama)
- FR-4.1 Setelah withdraw sukses pada suatu level, base token di-add kembali **ke posisi DLMM yang sama** (position address tidak berubah) pada bin-bin sisi base yang dimiliki posisi tersebut (rentang `max(activeBinId+1, lowerBinId)` s/d `upperBinId`). Tidak membuat posisi baru. *(Keputusan (a), konfirmasi user 2026-11-20 — menggantikan "bid-ask offset active bin" sebelumnya.)*
- FR-4.2 Base token hasil withdraw di-add kembali sesuai rentang bin FR-4.1 (add liquidity ke posisi existing). Parameter `bidAskBinRange` dihapus dari config.
- FR-4.3 Transaksi add menggunakan slippage protection dari config.

### FR-5 Siklus Berulang per Level
- FR-5.1 Siklus per level: monitor → level tercapai → withdraw → re-add → lanjut monitor untuk level berikutnya (s/d `maxSteps` atau likuiditas base habis).
- FR-5.2 Guard: tidak ada withdraw baru sebelum re-add sebelumnya selesai; tidak ada re-add ganda; tidak ada eksekusi ulang level yang sama.
- FR-5.3 Setiap aksi dicatat ke log file (JSON lines): timestamp, harga, level step, tx signature, jumlah token, alasan trigger.

### FR-6 Safety & Kontrol
- FR-6.1 Mode **dry-run**: semua keputusan & perhitungan dijalankan, transaksi tidak dikirim.
- FR-6.2 Batas aman: `maxSteps` membatasi jumlah level yang dieksekusi; di luar itu (harga sangat jauh di bawah), tools berhenti mengeksekusi dan hanya memantau + alert.
- FR-6.3 Cek balance & minimum likuiditas sebelum add; skip + log jika di bawah minimum.
- FR-6.4 Semua keypair dibaca dari env / file yang TIDAK di-commit ke repo.

### FR-7 Notifikasi Telegram
- FR-7.1 Tools mengirim notifikasi Telegram untuk event berikut:
  - Startup (mode dry-run/live, harga upper bin, harga saat ini, level berikutnya)
  - Level tercapai (level N, harga trigger, % dari upper bin)
  - Withdraw sukses / gagal (jumlah token, tx signature)
  - Re-add sukses / gagal (distribusi bin, tx signature)
  - `maxSteps` terlampaui / error fatal / stop eksekusi
  - Ringkasan berkala opsional (heartbeat, default off)
- FR-7.2 Pengiriman via **Telegram Bot API** (`sendMessage`) menggunakan HTTPS standar (fetch) — tanpa dependency tambahan.
- FR-7.3 `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID` dibaca dari **env**, TIDAK di config file; tidak pernah di-log.
- FR-7.4 Jika env Telegram tidak diset → notifikasi non-aktif (tools tetap jalan normal, hanya log file).
- FR-7.5 Notifikasi bersifat **non-blocking**: kegagalan kirim tidak menghentikan/memperlambat strategi; error kirim dicatat ke log + retry ringan (1x).
- FR-7.6 Pesan berformat markdown ringkas: event, harga, level, tx signature (link explorer).

### FR-8 Telegram Command & Control (v0.4)
- FR-8.1 Bot menerima command & button via **long-polling `getUpdates`** (Bot API, fetch standar — tanpa dependency tambahan); satu loop polling untuk seluruh lifecycle aplikasi.
- FR-8.2 **Whitelist chat**: hanya `TELEGRAM_CHAT_ID` (env) yang diproses; update dari chat/user lain diabaikan + dicatat di log. Command tidak diproses bila env Telegram tidak diset.
- FR-8.3 `/position` → fetch semua posisi DLMM wallet (FR-2.1) → bot membalas **satu pesan per posisi** berisi: pool/pair, rentang bin, harga upper bin, sisa base token, status (active flip / idle) — plus **inline button** `Activate Flip` (atau `Deactivate Flip` jika sudah aktif).
- FR-8.4 Tekan button → toggle activate/deactivate flip posisi tsb → `answerCallbackQuery` (konfirmasi singkat) + `editMessageText`/`editMessageReplyMarkup` untuk update status button; validasi posisi masih ada di chain sebelum activate.
- FR-8.5 `/stop` → deactivate **semua** posisi aktif (monitoring berhenti; state level tetap persist dan tidak di-reset).
- FR-8.6 `/status` → ringkasan semua posisi aktif: harga saat ini, % vs upper bin, level tercapai / level berikutnya, state machine per posisi.
- FR-8.7 Daftar posisi aktif + state per posisi persist di state file; setelah restart, monitoring posisi aktif dilanjutkan otomatis (NFR-1) setelah validasi posisi di chain.
- FR-8.8 Toggle bersifat **idempotent**: activate posisi yang sudah aktif (atau sebaliknya) tidak memicu efek ganda; guard double-execution (FR-5.2) berlaku per posisi.

### FR-9 Reverse Flip (Loop Adaptif, v0.6)
> Konsep loop: level dapat dieksekusi bolak-balik (1 → 2 → 1 → 2 → 3 → 2 → ...) selama flip aktif, agar fee tetap maksimal saat harga bergerak naik-turun di antara level.

- FR-9.1 Trigger reverse: saat harga/active bin **pulih melewati** threshold level `lastLevel` (level tertinggi yang sudah dieksekusi) — yaitu `activeBinId > thresholdBin(lastLevel)` (mode binPct) atau `currentPrice > levelPrice(lastLevel)` (mode pricePct) — dan `lastLevel ≥ 1`, eksekusi **reverse flip level lastLevel**.
- FR-9.2 Reverse flip: **withdraw seluruh sisi quote (Y)** dari posisi (bin `lowerBinId` s/d `min(activeBinId−1, upperBinId)`; bin di bawah active bin memegang Y), lalu **re-add** ke posisi yang sama.
- FR-9.3 Strategi re-add (`reverseFlip.strategy`):
  - `bidask` (default): seluruh Y di-add via `StrategyType.BidAsk`, single-sided Y, pada rentang bin sisi quote posisi.
  - `hybrid`: 50% Y di-add bid-ask single-sided Y, 50% di-add via `StrategyType.Spot` pada rentang quote (bin sisi quote + bin yang memuat active bin) — memungkinkan Y berkonversi ke X saat harga turun lagi.
- FR-9.4 **Rollback level**: setelah reverse flip sukses, `lastLevel` dikurangi 1 (level N selesai direverse → sistem kembali "siap trigger level N lagi"). Level yang sudah di-reverse dihapus dari `executedLevels` sehingga level yang sama bisa dieksekusi ulang (idempotency per-episode, bukan per-lifetime).
- FR-9.5 Reverse flip bersifat **idempotent per episode**: reverse untuk level N hanya boleh dieksekusi sekali sampai level N ter-trigger lagi (guard: `lastReversedLevel`).
- FR-9.6 Guard & safety yang sama berlaku (FR-5.2): lock state machine, `dryRun`, retry, slippage, cek balance minimum; gagal total → stop siklus posisi.
- FR-9.7 Konfigurasi: `reverseFlip.enabled` (default `true`), `reverseFlip.strategy` (`"bidask"` default | `"hybrid"`), `reverseFlip.hybridBidAskPct` (default `50`).
- FR-9.8 Setiap reverse flip dicatat di log JSONL + notif Telegram (event `reverseFlipTriggered`/`reverseWithdrawSuccess`/`reverseReAddSuccess`, tx signature).

### FR-10 Sweep Validation (PRD v0.7)
> Mencegah eksekusi akibat **wick/sweep sesaat**: harga menusuk level lalu langsung kembali — withdraw/re-add pada kondisi tsb membuang fee & menambah slippage.

- FR-10.1 Sebelum eksekusi (EXECUTE_LEVEL **dan** REVERSE_LEVEL), keputusan trigger yang sama (action + level) harus **bertahan N poll berturut-turut** (`sweepValidation.confirmations`, default `2`; `1` = perilaku lama tanpa validasi).
- FR-10.2 Satu tick yang tidak lagi memenuhi threshold (harga kembali) **mereset** hitungan konfirmasi; streak hanya dihitung untuk pasangan (action, level) yang sama persis.
- FR-10.3 Streak tidak dipersist (in-memory per monitor); restart engine hanya menunda eksekusi maksimal N-1 tick.
- FR-10.4 Saat trigger pertama terdeteksi tapi belum terkonfirmasi, dicatat log `sweepPending` (sekali per streak, tidak spam notifikasi).
- FR-10.5 MAX_STEPS_EXCEEDED tidak divalidasi (alert-only, tidak mengirim tx).

---

## 6. Non-Functional Requirements

| ID | Kategori | Requirement |
|----|----------|-------------|
| NFR-1 | Reliability | Uptime 24/7; auto-reconnect RPC + re-poll Telegram; state (posisi aktif, harga upper bin, level tercapai per posisi) dipulihkan setelah restart |
| NFR-2 | Latency | Polling harga ≤ 5 detik per posisi aktif; eksekusi transaksi ≤ 2 menit dari trigger |
| NFR-3 | Security | Private key tidak pernah di-log; .env di-gitignore; whitelist chat Telegram; verify address pool/posisi di chain sebelum eksekusi |
| NFR-4 | Observability | Log terstruktur (JSONL) + notifikasi Telegram (FR-7); tx signature selalu tercatat |
| NFR-5 | Testability | Unit test untuk perhitungan threshold, distribusi bin, dispatch command, toggle & guard double-execution; mode dry-run sebagai integrasi test |

---

## 7. Tech Stack (Usulan)

| Layer | Pilihan | Alasan |
|-------|---------|--------|
| Bahasa | TypeScript (Node.js ≥ 20) | SDK Meteora resmi TS-first |
| DLMM SDK | `@meteora-ag/dlmm-sdk` | API resmi: fetch pool, position, `addLiquidityByStrategy`, `removeLiquidity` |
| Solana | `@solana/web3.js`, `@solana/spl-token` | Interaksi chain standar |
| RPC | Helius / Triton (HTTPS + WSS) | Stabilitas & rate limit memadai |
| Config | `zod` + file JSON | Validasi kuat |
| Log | `pino` (JSONL) | Log terstruktur ringan |
| Notifikasi & C&C | Telegram Bot API via `fetch` (sendMessage + getUpdates + inline button callback) | Tanpa dependency tambahan; alert real-time (FR-7) + kontrol via command (FR-8) |
| Test | `vitest` | Cepat, TS-native |
| Runner | Long-running process (`tsx` / `node`) | v1: bot Telegram, tanpa GUI/CLI interaktif |

> Hasil riset SDK (2026-11-20, T-0.3/T-0.4): package npm resmi adalah **`@meteora-ag/dlmm`** (bukan `dlmm-sdk`). `StrategyType` = `Spot | Curve | BidAsk`; `StrategyParameters = { minBinId, maxBinId, strategyType, singleSidedX? }` dengan rentang tunggal — bid = bin di bawah active (token Y/quote), ask = bin di atas active (token X/base). `removeLiquidity` memakai rentang `fromBinId`/`toBinId` + `bps` (10000 = 100%); withdraw sisi base = rentang `activeBinId+1` s/d `upperBinId`. Order X/Y per pool harus diverifikasi runtime via `pool.tokenX`/`pool.tokenY`.
>
> Hasil riset T-6.1 (2026-11-20): list semua posisi user lintas pool = **`DLMM.getAllLbPairPositionsByUser(connection, userPubKey)`** → `Map<lbPairAddress, PositionInfo>`; `PositionInfo = { publicKey, lbPair, tokenX, tokenY, lbPairPositionsData: LbPosition[] }` (satu pool bisa berisi beberapa posisi). Alternatif filter token: `getPositionsByUserAndTokenAddress`. Catatan: `Mint` spl-token tidak punya `symbol` — label pair pakai prefix mint address.

---

## 8. Alur Eksekusi (Happy Path)

```
[Start] Load config + wallet (env) + state recovery (posisi aktif)
   │
   ├─► BOT TELEGRAM (getUpdates long-polling, whitelist chat)
   │      │
   │      ▼
   │   /position ──► fetch semua posisi DLMM wallet
   │      │           └─► 1 pesan per posisi + button [Activate Flip]
   │      │
   │      ▼
   │   [Activate Flip] ditekan ──► posisi masuk daftar MONITOR (persist)
   │      │                        (validasi posisi di chain, refPrice = harga upper bin)
   │      │
   │      ▼
   │   /status ──► ringkasan per posisi aktif   ·   /stop ──► deactivate semua
   │
   ├─► MONITOR per posisi aktif (poll harga pool, interval config)
   │      │
   │      ▼
   │   currentPrice vs level berikutnya
   │   levelN = upperBinPrice × (1 + stepPct × N)
   │      │
   │   belum menyentuh levelN? ──► loop monitor
   │      │
   │   levelN tercapai (N ≤ maxSteps)?
   │      │
   │      ▼
   │   WITHDRAW base token (removeLiquidity) ──► 📲 notif Telegram
   │      │
   │      ▼
   │   RE-ADD bid-ask @ offset active bin ──► 📲 notif Telegram
   │      │
   │      ▼
   │   Tandai level N selesai → N+1 → kembali ke monitor
   │
   └─[N > maxSteps / error fatal] ──► Stop eksekusi posisi tsb + 📲 alert Telegram (bot & posisi lain tetap jalan)
```

---

## 9. Open Questions (perlu konfirmasi sebelum/implementasi)

| ID | Pertanyaan | Status / Default |
|----|------------|-------------------|
| Q-1 | ~~Harga -20% dihitung dari harga apa?~~ | ✅ **TERJAWAB (2026-11-20):** dari **harga upper bin posisi** (fixed per siklus), dieksekusi setiap -20% step bertingkat |
| Q-2 | ~~Level bertingkat additive atau compounding?~~ | ✅ **TERJAWAB (2026-11-20):** **Additive** — level = 80%, 60%, 40% dari harga upper bin |
| Q-3 | ~~"Posisi yang sama" = rentang bin ID yang sama persis, atau offset relatif terhadap active bin seperti posisi lama?~~ | ✅ **TERJAWAB (2026-11-20):** **Offset relatif active bin** — rentang bin bid-ask dihitung relatif active bin saat trigger (bid di bawah active, ask di atas active), dengan width dari `bidAskBinRange` config |
| Q-4 | Setelah flip, sisi yang terisi jadi quote token — dikelola (re-balancing) atau dibiarkan? | Dibiarkan di v1 |
| Q-5 | Mainnet langsung atau devnet dulu untuk validasi end-to-end? | Devnet → mainnet-beta |
| Q-6 | ~~Satu posisi per pool atau dukung multi-posisi?~~ | ✅ **TERJAWAB (2026-11-20):** **Multi-posisi paralel** — posisi dipilih via button Telegram; hanya posisi aktif yang dimonitor, state & lock per posisi (v0.4) |
| Q-8 | ~~dryRun global atau per posisi?~~ | ✅ **TERJAWAB (2026-11-20):** **Global dari config** — tidak ada toggle live/dry dari Telegram (v0.4) |
| Q-9 | ~~Kontrol tambahan selain /position?~~ | ✅ **TERJAWAB (2026-11-20):** `/stop` (deactivate semua) + `/status` (ringkasan level per posisi) + button toggle activate/deactivate per posisi; whitelist chat via `TELEGRAM_CHAT_ID` (v0.4) |
| Q-10 | ~~Re-add: ke posisi lama (rentang bin existing) atau posisi baru dengan `addLiquidityByStrategy(BidAsk)`?~~ | ✅ **TERJAWAB (2026-11-20):** **Posisi lama (a)** — base token di-add kembali ke position address yang sama, pada bin sisi base milik posisi (`activeBinId+1` s/d `upperBinId`); tidak ada posisi baru; `bidAskBinRange` dihapus dari config |
| Q-11 | ~~Step fixed dari harga upper bin atau persentase dari lebar bin posisi?~~ | ✅ **TERJAWAB (2026-11-20):** Ditambah config `triggerMode`: **`pricePct`** (default, perilaku lama FR-3.1) atau **`binPct`** — step = persentase dari jumlah bin posisi, trigger per bin ID (FR-3.1b, PRD v0.5) |
| Q-12 | Reverse flip: strategi re-add saat harga naik kembali? | ✅ **TERJAWAB (2026-11-22):** config `reverseFlip.enabled` (default true) + `reverseFlip.strategy` (`bidask` \| `hybrid`, default `bidask`); hybrid = 50% bid-ask single-sided Y, 50% spot (FR-9, PRD v0.6) |
| Q-7 | ~~Withdraw seluruh vs sebagian sisa base per level?~~ | ✅ **TERJAWAB (2026-11-20):** **Seluruh sisa base token** di posisi per level |

---

## 10. Acceptance Criteria (v1)

- [ ] AC-1: Tools berjalan 24/7 sebagai bot Telegram; posisi aktif dimonitor tanpa intervensi (termasuk dilanjutkan setelah restart).
- [ ] AC-2: `/position` menampilkan semua posisi wallet, 1 pesan per posisi dengan info bin/harga/sisa base + button toggle; command dari chat di luar whitelist diabaikan.
- [ ] AC-3: Activate Flip via button memulai monitoring posisi tsb (dry-run: hanya keputusan tercatat).
- [ ] AC-4: Harga referensi = harga upper bin posisi, terverifikasi sesuai `binStep` pool (per posisi).
- [ ] AC-5: Pada harga menyentuh level -20% step dari upper bin (simulasi devnet/dry-run), withdraw base token terjadi otomatis dan tx sukses (atau ter-simulasi benar di dry-run).
- [ ] AC-6: Setiap level hanya dieksekusi satu kali per posisi, termasuk setelah restart (persist di state).
- [ ] AC-7: Re-add bid-ask (offset relatif active bin) terjadi otomatis setelah withdraw sukses per level.
- [ ] AC-8: `/stop` menghentikan semua monitoring; `/status` menampilkan level tercapai/berikutnya per posisi.
- [ ] AC-9: Semua aksi tercatat di log JSONL dengan tx signature & level step.
- [ ] AC-10: Dry-run menghasilkan output keputusan identik tanpa mengirim transaksi.
- [ ] AC-11: `maxSteps` & guard anti double-execution teruji (termasuk multi-posisi paralel).
- [ ] AC-12: Dokumentasi penggunaan (cara set config, jalankan bot, command Telegram) tersedia di README.
- [ ] AC-13: Notifikasi Telegram terkirim untuk semua event FR-7.1 saat env diset; tools tetap berjalan normal saat env tidak diset atau Telegram error.
