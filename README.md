# LamaranKilat

CV + surat lamaran siap ATS dalam hitungan menit, dipesan lewat WhatsApp. Satu container Node.js: HTTP API, dashboard admin, worker antrean, dan gateway WhatsApp dalam satu proses.

- Produksi: `http://192.168.100.24:8092`
- Dashboard admin: `/admin`
- Alat publik gratis: `/cek-ats`
- Simulator alur WhatsApp: `/simulator`

## Fitur

**Pelanggan (WhatsApp)**
- Percakapan terpandu: paket → nama → posisi target → pengalaman → skill → pendidikan → preview skor ATS → bayar → terima dokumen.
- Preview skor ATS gratis sebelum bayar (deterministik, bukan tebakan LLM).
- Dua paket: CV saja (Rp15.000) dan CV + surat lamaran (Rp35.000), revisi Rp10.000.
- Nominal transfer unik 3 digit terakhir untuk verifikasi otomatis.
- Pengiriman `PDF` + `DOCX` + laporan skor ATS langsung ke chat WhatsApp.
- Revisi satu kali, batas 1 MB per dokumen (batas WhatsApp).

**Operasional**
- Dashboard: order, pendapatan, konversi, status WhatsApp/9Router, disk, antrean job.
- Verifikasi pembayaran manual (approve → generate otomatis).
- Regenerate, kirim ulang, tutup order, refund, batalkan.
- Antrean job SQLite dengan retry eksponensial dan dead-letter.
- Audit log, retensi artefak 30 hari, hapus data pelanggan (hard delete file + isi input).

**Teknis**
- Satu container, satu proses Node (`src/index.js`): API + worker + WA gateway.
- SQLite (`better-sqlite3`, WAL) — tanpa Redis/Postgres/MySQL.
- Dokumen PDF via `pdfkit`, DOCX via `docx`.
- WhatsApp via Baileys, dimuat **dinamis** hanya bila `WA_ENABLED=true`.
- AI via 9Router (OpenAI-compatible) dengan fallback template deterministik bila AI gagal.
- Tanpa native module selain `better-sqlite3`; password admin memakai `scrypt` (`node:crypto`).
- Logger JSON sendiri, rotasi harian 7 file.

## Menjalankan

```bash
cp .env.example .env      # isi ADMIN_PASS, SESSION_SECRET, INTERNAL_TOKEN, dsb.
docker compose up -d --build
curl -s localhost:8092/health | jq
```

Seed data demo (3 order nyata + dokumen):

```bash
docker compose exec app node scripts/seed-demo.js --yes
```

Dokumen tersimpan di `./data/artefacts/<kode>/v1/`, log di `./data/logs/`, database di `./data/db/lamarankilat.db`.

## Konfigurasi penting

| Variabel | Arti |
|---|---|
| `PAYMENT_MODE` | `transfer_manual` (bank), `qris_static`, `manual_confirm` (admin kirim detail), `gateway` |
| `BANK_NAME` / `BANK_ACCOUNT` / `BANK_HOLDER` | wajib untuk `transfer_manual` |
| `WA_ENABLED` | `true` mengaktifkan Baileys + QR di `/admin/settings` |
| `ROUTER9_BASE_URL` / `ROUTER9_API_KEY` | endpoint AI OpenAI-compatible |
| `PRICE_CV` / `PRICE_BUNDLE` / `PRICE_REVISION` | harga dalam rupiah |
| `ARTEFACT_TTL_DAYS` | masa simpan dokumen sebelum dibersihkan worker |
| `ALERT_TELEGRAM_CHAT_ID` / `TELEGRAM_BOT_TOKEN` | notifikasi order gagal ke Telegram |

`PAYMENT_MODE=manual_confirm` dipakai pada staging agar alur bisa diuji tanpa rekening asli; untuk produksi isi rekening dan pakai `transfer_manual`.

## Struktur

```
src/index.js            entrypoint HTTP + worker + WA
src/config.js           konfigurasi dari env
src/routes/             public, simulator, admin
src/views/              HTML server-rendered
src/services/           order, pembayaran, dokumen, ATS, percakapan, job, retensi
src/services/docs/      renderer PDF/DOCX
src/services/wa/        transport + Baileys
src/jobs/               handler job (generate, kirim, followup, maintenance)
migrations/             skema SQL
tests/                  node:test
scripts/                healthcheck, seed demo
```

## Keamanan

- Cookie sesi `HttpOnly`, `SameSite=Strict`, ditandatangani HMAC-SHA256, masa 12 jam.
- CSRF: POST admin menolak `Origin` yang tidak cocok dengan `Host`.
- Rate limit pesan WhatsApp: 10/menit per nomor; batas harian `WA_DAILY_LIMIT`.
- Rate limit alat publik: 30 permintaan/jam per IP.
- Rahasia hanya dari env; tidak ada kredensial di repo.

## Testing

```bash
docker compose run --rm app node --test tests/
```
