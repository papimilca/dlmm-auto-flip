# dlmm-auto-flip — Meteora DLMM Bid-Ask and Flip Bot

Tools ini terinspirasi dari article @yunus-0x https://x.com/0xyunss/status/2123387410725953788

Tools otomatis untuk posisi **Meteora DLMM (Solana)** yang menjalankan strategi bid-ask flip:

1. Membaca posisi DLMM wallet; harga upper bin posisi menjadi harga referensi (anchor, fixed per siklus).
2. Saat harga turun bertingkat dari anchor (default: setiap -20%), bot **withdraw** likuiditas sisi Base token lalu **re-add** dengan strategi **bid-ask** pada rentang bin yang sama.
3. Setiap level dieksekusi tepat satu kali (idempotent, state dipersist). Siklus berlanjut sampai `maxSteps` atau likuiditas habis.

Kontrol & monitoring berjalan via **Telegram bot** (daftar posisi, activate/deactivate flip, stop).

> Spesifikasi lengkap: [PRD.md](./PRD.md) · Progres task: [roadmap.md](./roadmap.md)

---

## ⚠️ Peringatan

Bot ini mengoperasikan **dana nyata di Solana**. Selalu mulai dengan `dryRun: true`, lalu aktifkan live mode hanya setelah memahami risikonya. Jangan pernah commit file `.env` atau private key.

---

## Prasyarat

- **Node.js ≥ 20**
- **pnpm** (`npm install -g pnpm`)
- Wallet Solana dengan posisi DLMM di Meteora
- Telegram Bot token (dari [@BotFather](https://t.me/BotFather)) dan chat ID Anda

## Instalasi

```bash
git clone <repo-url> ba_flip
cd ba_flip
pnpm install
```

## Konfigurasi

### 1. Environment (`.env`)

Salin template lalu isi:

```bash
cp .env.example .env
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SOLANA_WALLET_KEY` | ya* | Private key wallet — format base58 (Phantom/Solflare), base64, atau JSON keypair array |
| `WALLET_PATH` | ya* | Path file keypair `id.json` (alternatif jika `SOLANA_WALLET_KEY` kosong) |
| `RPC_URL` | ya | HTTPS RPC endpoint (mainnet disarankan provider berbayar, bukan public) |
| `TELEGRAM_BOT_TOKEN` | ya | Token bot dari @BotFather (command & control) |
| `TELEGRAM_CHAT_ID` | ya | Chat ID yang berhak mengirim command |
| `STATE_PATH` | tidak | Path file state (default `state/state.json`) |

\* Salah satu dari `SOLANA_WALLET_KEY` atau `WALLET_PATH` harus diisi.

### 2. Config strategi (`config.json`)

```bash
cp config.example.json config.json
```

```json
{
  "stepPct": -10,
  "triggerMode": "binPct",
  "maxSteps": 5,
  "slippageBps": 100,
  "dryRun": true,
  "pollIntervalMs": 5000,
  "txMaxRetries": 3,
  "telegramPollTimeoutSec": 30
}
```

| Field | Default | Keterangan |
|---|---|---|
| `stepPct` | `-20` | Ukuran step penurunan harga yang memicu flip (harus negatif) |
| `triggerMode` | `pricePct` | `pricePct` = step aditif dari harga upper bin; `binPct` = step sebagai persentase lebar bin posisi (dihitung di bin ID) |
| `maxSteps` | `5` | Maksimum jumlah level flip per siklus |
| `slippageBps` | `100` | Slippage tolerance transaksi (basis point) |
| `dryRun` | `true` | `true` = tidak ada transaksi on-chain (simulasi). **Set `false` hanya saat siap live** |
| `pollIntervalMs` | `5000` | Interval polling harga |
| `txMaxRetries` | `3` | Retry maksimum per transaksi |
| `telegramPollTimeoutSec` | `30` | Timeout long-poll Telegram getUpdates |

## Menjalankan

### Development

```bash
pnpm dev                    # dry-run (sesuai config.json), mode watch via tsx
pnpm test                   # unit test (vitest)
pnpm test:watch
```

### Production (build dulu)

```bash
pnpm build
pnpm start                  # node dist/index.js
```

Path config bisa diberikan sebagai argumen:

```bash
node dist/index.js /path/ke/config.json
```

### Interaksi via Telegram

Setelah bot berjalan, kirim command ke bot Anda:
- Daftar posisi → bot menampilkan semua posisi DLMM wallet dengan tombol **Activate/Deactivate Flip**
- **Stop** → menghentikan semua flip aktif

---

## Deploy di VPS dengan PM2

### 1. Siapkan VPS

```bash
# Ubuntu/Debian — install Node.js 20+ dan pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm pm2
```

### 2. Upload project & siapkan file

```bash
# dari lokal (atau git clone di VPS)
rsync -avz --exclude node_modules --exclude .git ./ user@vps:/opt/ba_flip/

ssh user@vps
cd /opt/ba_flip
pnpm install --frozen-lockfile   # atau: pnpm install --prod=false && pnpm build
pnpm build
```

Kemudian buat file rahasia di VPS (jangan pernah commit):

```bash
nano .env          # isi SOLANA_WALLET_KEY / WALLET_PATH, RPC_URL, TELEGRAM_*
cp config.example.json config.json
nano config.json   # sesuaikan strategi; pastikan dryRun sesuai kebutuhan
```

Amankan permission:

```bash
chmod 600 .env config.json
```

### 3. Jalankan dengan PM2

```bash
pm2 start dist/index.js --name ba_flip
# atau dengan config path eksplisit:
pm2 start dist/index.js --name ba_flip -- /opt/ba_flip/config.json

pm2 save              # simpan process list
pm2 startup           # auto-start saat boot (ikuti instruksi output)
```

Perintah operasional:

```bash
pm2 status            # cek status
pm2 logs ba_flip      # lihat log (JSONL)
pm2 logs ba_flip --lines 200
pm2 restart ba_flip   # restart (misal setelah ubah config)
pm2 stop ba_flip      # stop
pm2 monit             # monitor CPU/memory realtime
```

### 4. Rotasi log (opsional, disarankan)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
```

### Catatan keamanan VPS

- Gunakan RPC endpoint privat (Helius/QuickNode) — public RPC mudah rate-limited.
- Simpan keypair di luar repo; batasi akses file dengan `chmod 600`.
- Pastikan `state/state.json` tidak terhapus — berisi anchor price & progres siklus (idempotency). Backup secara berkala.
- Matikan `dryRun` hanya setelah verifikasi perilaku bot di mode simulasi.

---

## Update / Redeploy

```bash
cd /opt/ba_flip
git pull                     
pnpm install
pnpm build
pnpm restart ba_flip
```
