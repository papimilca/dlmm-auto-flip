# AGENTS.md — Panduan Kerja untuk AI Agent di Repo Ini

> Dokumen ini adalah kontrak kerja untuk AI agent / kontributor yang bekerja di repo `ba_flip`.
> Baca file ini SELURUHNYA sebelum melakukan perubahan apa pun.

---

## 1. Konteks Proyek

Repo ini adalah tools otomatis untuk **Meteora DLMM (Solana)** yang menjalankan strategi:

1. Membaca **posisi DLMM** yang ada; **harga upper bin posisi** menjadi harga referensi (fixed per siklus).
2. Memantau harga aktif; **setiap -20% step bertingkat dari harga upper bin** (level: -20%, -40%, ...): **withdraw** likuiditas sisi Base token, lalu **re-add** dengan strategi **bid-ask** pada posisi bin yang sama (bid-ask flip).
3. Setiap level dieksekusi tepat satu kali (idempotent, persist di state); siklus berlanjut sampai `maxSteps`/likuiditas habis.

Alur besar: cek posisi → cek harga → cek penurunan dari upper bin → withdraw + add liquidity setiap -20% dari upper bin.

Spesifikasi lengkap ada di [PRD.md](./PRD.md). Daftar tugas & progres ada di [roadmap.md](./roadmap.md).

---

## 2. Tech Stack (WAJIB diikuti)

- **Runtime:** Node.js ≥ 20, TypeScript (strict mode).
- **Package manager:** pnpm (kecuali user minta lain).
- **SDK:** `@meteora-ag/dlmm-sdk`, `@solana/web3.js`, `@solana/spl-token`.
- **Validasi config:** `zod`.
- **Logging:** `pino` dengan output JSONL.
- **Notifikasi:** Telegram Bot API via `fetch` standar (tanpa dependency tambahan); `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID` hanya dari env, tidak pernah di-log.
- **Test:** `vitest`.
- **Menjalankan:** via `tsx` atau build + `node dist/`.

---

## 3. Struktur Direktori Target

```
ba_flip/
├── PRD.md
├── AGENTS.md            # file ini
├── roadmap.md           # task tracking — WAJIB diupdate
├── package.json
├── tsconfig.json
├── .env.example         # template env, TANPA nilai rahasia
├── .gitignore
├── config.example.json # template config strategi
├── src/
│   ├── index.ts         # entry point CLI
│   ├── config/
│   │   ├── schema.ts    # zod schema
│   │   └── loader.ts
│   ├── dlmm/            # wrapper Meteora SDK (pool, position, harga)
│   ├── strategy/        # engine: monitor, trigger, withdraw, re-add, anchor
│   ├── tx/              # building & sending transaksi, retry
│   ├── state/           # persist anchor price & siklus
│   ├── logger/
│   ├── notify/         # notifikasi Telegram (Bot API, non-blocking)
│   └── utils/
└── tests/
    └── ...mirror src/
```

> Jangan menambahkan abstraksi/layer yang tidak dibutuhkan PRD. Ikuti prinsip: kompleksitas minimum.

---

## 4. Aturan Kerja (Hard Rules)

### 4.1 Keamanan
- **JANGAN PERNAH** commit private key, seed phrase, atau file `.env` berisi nilai asli.
- Private key hanya dibaca dari env var: `SOLANA_WALLET_KEY` (JSON keypair array) atau path di `WALLET_PATH`.
- Telegram `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` hanya dari env; **jangan log** token; pengiriman notifikasi non-blocking (gagal kirim tidak boleh mengganggu strategi).
- **Jangan log** private key atau signature berlebihan; log tx signature saja.
- Verifikasi address pool/position terhadap chain sebelum kirim transaksi.

### 4.2 Uang Riil
- Tools ini mengoperasikan **dana nyata di Solana**. Semua path eksekusi transaksi harus:
  - Menghormati `dryRun` dari config (tidak boleh ada jalur yang bypass).
  - Memiliki retry + slippage protection.
  - Memiliki guard anti double-execution (lock state per siklus).
- Perubahan pada `src/strategy/` dan `src/tx/` wajib disertai test.

### 4.3 Workflow per Task
1. Baca task di [roadmap.md](./roadmap.md) yang berstatus `pending`/`in_progress`.
2. Sebelum menulis kode: baca file terkait yang sudah ada. Jangan mengubah kode yang belum dibaca.
3. Implementasi **minimum** sesuai PRD — tanpa fitur ekstra, tanpa refactor tidak diminta.
4. Jalankan: `pnpm lint` (jika ada), `pnpm test`, `pnpm build`.
5. Update roadmap.md:
   - Tandai checkbox task (`[ ]` → `[x]`).
   - Isi kolom **Status** (`pending` / `in_progress` / `done` / `blocked`).
   - Isi **Log Perubahan** di bawah tabel: tanggal, task ID, file yang diubah, ringkasan.
6. Jika task membuka pertanyaan baru → tambahkan ke section Open Questions di PRD.md, jangan memutuskan sendiri hal berdampak dana.

### 4.4 Coding Convention
- TypeScript strict; **tanpa `any`** (gunakan tipe SDK atau definisikan interface).
- Komentar hanya untuk logika non-obvious. Bahasa komentar/kode: Inggris; bahasa dokumen (PRD/roadmap): Indonesia.
- Nama file: `camelCase.ts`; nama class/fungsi: `PascalCase` / `camelCase`.
- Error handling: hanya pada boundary (RPC, config load, user input). Jangan try-catch berlebihan di internal code.
- Semua angka strategi (harga, bin, amount) memakai tipe aman: harga pakai `new BN` / decimal string — **jangan** floating point untuk nilai on-chain.

### 4.5 Git
- Commit hanya jika user meminta.
- Pesan commit: konvensional (`feat:`, `fix:`, `docs:`, `chore:`) + referensi task ID dari roadmap, contoh: `feat(strategy): trigger withdraw -20% (T-3.1)`.

### 4.6 Testing
- Unit test wajib untuk: perhitungan threshold, distribusi bin bid-ask, anchor update, guard double-execution.
- Mock SDK/network di unit test (tidak ada RPC call di CI).
- Integrasi test pakai devnet atau mode dry-run.

---

## 5. Pengetahuan Domain Penting (DLMM Meteora)

- DLMM memakai model **bin discretized**; harga aktif ada di **active bin**. `binId` berhubungan dengan harga via `binStep` (basis point per bin).
- Posisi likuiditas didefinisikan oleh rentang bin (`lowerBinId`–`upperBinId`); token pada bin di atas active bin berupa base token, di bawah active bin berupa quote token (untuk sisi bid/ask harus divalidasi ulang saat implementasi — cek `PositionBidAsk`/residue SDK).
- Fungsi SDK utama: `DlmmPool.create(connection, address)`, `pool.getActiveBin()`, `position.getPositionData()`, `pool.addLiquidityByStrategy(...)`, `pool.removeLiquidity(...)`.
- `StrategyType` SDK mendukung varian BidAsk — pastikan mapping parameter bin (bid/ask width) benar sebelum dipakai di jalur uang riil (ini task riset T-2.x di roadmap).

---

## 6. Definition of Done (per task)

Task dianggap selesai hanya jika SEMUA terpenuhi:

- [ ] Kode mengikuti konvensi section 4.4.
- [ ] `pnpm test` lulus (atau test baru ditulis bila logika baru).
- [ ] `pnpm build` sukses tanpa error TS.
- [ ] roadmap.md di-update (checkbox + status + log perubahan).
- [ ] Tidak ada secret di diff.
- [ ] Jalur transaksi (jika ada) menghormati `dryRun` + guard.

---

## 7. Perintah Standar

```bash
pnpm install          # install dependency
pnpm dev              # jalankan tools (dry-run default saat dev)
pnpm build            # compile TS
pnpm test             # jalankan vitest
pnpm test:watch       # test mode watch
```

> Jika script belum ada di package.json, buat saat task setup (T-1.x), bukan ad-hoc.
