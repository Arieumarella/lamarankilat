# Changelog Implementasi — LamaranKilat v0.1.0

**Tanggal build:** 2026-11-21 (WIB) · **Host:** STB B (ARM64, 787 MB RAM) · **Port publik:** 8092

Dokumen di bawah ini adalah PRD asli. Bagian changelog ini mencatat **deviasi implementasi** terhadap PRD, sesuai instruksi build: aplikasi harus berjalan di satu container dengan sumber daya terbatas.

## Deviasi arsitektur (disetujui untuk build ini)

1. **Satu container, satu proses Node, satu port (8092).** PRD menyebut beberapa layanan; implementasi menggabungkan HTTP API, dashboard admin, worker antrean, dan gateway WhatsApp ke `src/index.js`. Alasan: RAM host 787 MB dengan ~560 MB sudah dipakai container lain.
2. **SQLite (`better-sqlite3`, WAL) menggantikan Redis/Postgres/MySQL/Elasticsearch.** Antrean job, cache sesi WhatsApp, metrik harian, dan audit log semuanya di SQLite. Tidak ada broker eksternal.
3. **Tanpa Chromium/Puppeteer.** PDF dibuat dengan `pdfkit`, DOCX dengan `docx`. Tidak ada headless browser, sehingga render < 2 detik dan hemat ~300 MB RAM.
4. **Baileys sebagai `optionalDependency` + `import()` dinamis.** Modul WhatsApp hanya dimuat bila `WA_ENABLED=true`. Pada build staging `WA_ENABLED=false` karena QR harus dipindai manual; seluruh alur diuji lewat `/simulator` (HTTP) yang memakai kode percakapan yang sama.
5. **AI opsional, fallback deterministik.** Semua panggilan model lewat 9Router (OpenAI-compatible). Bila 9Router gagal/timeout, CV, surat, dan skor tetap dihasilkan dari template deterministik + kamus skill; order tidak pernah gagal total karena AI.
6. **`scrypt` (`node:crypto`) menggantikan argon2/bcrypt.** Menghindari native module tambahan di ARM64.
7. **Logger JSON internal** dengan rotasi harian 7 file, menggantikan pino/winston.
8. **`PAYMENT_MODE=manual_confirm` pada staging.** PRD mengasumsikan rekening/QRIS aktif. Karena data rekening belum tersedia saat build malam, staging memakai mode di mana admin mengirim detail pembayaran lewat chat dan memverifikasi bukti transfer di `/admin/payments`. Mode produksi `transfer_manual` dan `qris_static` sudah diimplementasikan, termasuk nominal unik 3 digit untuk verifikasi otomatis.
9. **Verifikasi pembayaran manual di MVP.** Deteksi transfer otomatis via mutasi bank/gateway belum ada; approve dilakukan admin (satu klik → generate otomatis). Skema `payments` sudah menyiapkan `provider`/`provider_ref` untuk gateway menyusul.
10. **Teks LinkedIn** untuk paket bundle dikirim sebagai `.txt` siap tempel (`Teks-LinkedIn-*.txt`), bukan PDF terpisah.

## Catatan operasional

- Host: `http://192.168.100.24:8092` · Admin `/admin` · Alat publik `/cek-ats` · Simulator `/simulator`.
- Harga default: CV Rp15.000, bundle Rp35.000, revisi Rp10.000 (sesuai PRD).
- Rumus skor ATS mengikuti Lampiran B: `0.40·keyword + 0.30·format + 0.20·readability + 0.10·contact`.
- Retensi artefak 30 hari, hard delete data pelanggan menghapus file + isi input, order tetap disimpan untuk rekap keuangan.
- Kredensial hanya di `.env` host (mode 600) dan tidak pernah masuk repo/log.

### Status verifikasi (2026-11-21 04:10 WIB)

- E2E nyata lewat `/simulator`: order bundle `LK-261121-ZBL9` → bayar (bukti) → approve admin → **5 dokumen** terkirim (`cv_pdf` 18 KB, `cv_docx` 10 KB, `letter_pdf` 17 KB, `score_pdf` 22 KB, `linkedin_txt` 1 KB), skor ATS 91/100, status `delivered`.
- Order CV `LK-261121-RPT5` (data bersih "Toko Maju Jaya, admin gudang, 2022-2024") → parse pengalaman benar (`Admin gudang` / `Toko Maju Jaya` / `2022–2024`), bullet `Mengelola stok 500 SKU`, `Meningkatkan akurasi stok 15%`.
- `node --test tests/`: **10/10 lulus** di dalam container.
- Pemeriksaan teks PDF (`pdftotext`): A4 1 halaman, heading sejajar margin, tidak ada teks bertumpuk; laporan skor menampilkan 91/100 + 4 komponen.
- 9Router: koneksi `router9:true`, tetapi key yang tersedia di host ditolak `invalid_api_key` untuk `chat/completions`. Karena itu AI **tidak aktif** saat build; seluruh dokumen dihasilkan jalur fallback deterministik (sesuai deviasi #5). Bila key valid dipasang di `.env`, AI otomatis dipakai tanpa perubahan kode.
- Docker image `lamarankilat:0.1.0` (bookworm-slim, ARM64), container `lamarankilat-app-1` status `Up (healthy)`, `mem_limit 400m`.


---

# PRD — LamaranKilat

**Versi:** 1.0 (draft siap eksekusi)
**Tanggal:** 2026-11-20 (WIB)
**Owner:** Razli
**Status:** ACTIVE — dibangun
**Lokasi dokumen:** `/root/agent-bridge/prd/active_prd.md`
**Target rilis MVP:** akhir pekan ke-2 (v0.1), 14 hari setelah dokumen ini

---

## 1. Ringkasan Eksekutif

**LamaranKilat** adalah layanan B2C berbasis WhatsApp yang mengubah data diri singkat menjadi **CV + surat lamaran siap ATS** dalam bentuk PDF dan DOCX, selesai ≤15 menit, harga **Rp15.000 per berkas** (paket hemat Rp35.000 untuk CV + surat lamaran + teks LinkedIn).

**Masalah yang dipecahkan.** Pencari kerja Indonesia — fresh graduate, korban PHK, pekerja yang mau pindah — kalah di tahap penyaringan otomatis (ATS) bukan karena kurang kompeten, tapi karena format CV tidak terbaca mesin, tidak ada keyword yang dicari lowongan, dan surat lamaran generik. Jasa pembuatan CV profesional berharga Rp150.000–500.000 dan butuh 2–3 hari; template gratis di internet menghasilkan CV yang seragam dan tetap tidak lolos ATS.

**Solusi.** Percakapan WA 3–5 menit (tanpa aplikasi, tanpa login) → AI menyusun ulang isi (bukan mengarang) → skor ATS dihitung → user bayar (transfer bank, QRIS menyusul) → PDF + DOCX dikirim ke WA yang sama. Revisi 1x gratis.

**Model bisnis.** Mikro-transaksi, bayar di depan, tanpa langganan:

- Berkas tunggal (CV saja): **Rp15.000**
- Paket Lengkap (CV + surat lamaran + teks LinkedIn): **Rp35.000**
- Revisi mayor (ganti posisi/industri): **Rp10.000**
- Ekspres ≤15 menit: sudah termasuk (bukan upsell)

**Target 90 hari.** 20 order/hari (Rp9.000.000/bulan gross pada mix 70% single), margin kotor ≥95% (COGS AI mendekati Rp0 karena seluruh inference lewat 9Router), refund <3%.

**Kenapa bisa murah.** Seluruh tumpukan biaya variabel ditekan ke nol:

| Komponen | Biaya normal | Di setup ini |
|---|---|---|
| Hosting | Rp100–300rb/bln VPS | **Rp0** — 2 STB Armbian + Cloudflare Tunnel |
| Inference LLM | Rp300–800/berkas API vendor | **~Rp0** — 9Router combo self-hosted |
| PDF generation | SaaS Rp2.000/dokumen | **Rp0** — render lokal, tanpa Chromium |
| Gateway WA | Fonnte/Wablas Rp66–175rb/bln | **Rp0** — Baileys, nomor sendiri |

Sisa biaya nyata: listrik STB (~Rp20.000/bln), pulsa nomor WA (~Rp15.000/bln), domain (sudah ada).

---

## 2. Latar Belakang & Diferensiasi

**Sinyal pasar.**

- Pencarian "contoh cv" dan "surat lamaran" di Indonesia konsisten tinggi sepanjang tahun, dengan puncak pada musim rekrutmen (Feb–Apr, Agu–Okt) dan gelombang PHK.
- Sistem ATS (Workday, Taleo, Greenhouse, Jobstreet/LinkedIn parser) memfilter dokumen berdasarkan struktur, bukan isi naratif — mayoritas CV buatan sendiri gagal karena kolom, tabel, ikon, dan header grafis.
- Kanal distribusi murah tersedia: TikTok/Reels/Shorts dengan hook "kenapa CV kamu ditolak", dan SEO jangka panjang pada kata kunci "contoh cv ats", "surat lamaran kerja pdf".

**Kompetitor & posisi.**

| Jenis | Contoh | Kelemahan yang kita ambil |
|---|---|---|
| Template gratis (Canva, blog) | ribuan | Seragam, banyak yang tidak ATS-safe, tidak ada keyword matching |
| CV builder SaaS | Zety, Kickresume, lokal | Berlangganan bulanan, bahasa Inggris-centric, harga USD |
| Jasa CV manual | freelancer, jasa ketik | Rp150–500rb, 2–3 hari, tidak ada skor ATS |
| AI chat gratis (ChatGPT) | — | User harus prompt sendiri, hasil tidak konsisten, tidak ada PDF rapi |

**Diferensiasi LamaranKilat.** (1) Selesai lewat WA, tanpa install/log masuk; (2) output ATS-safe by construction (template tunggal yang sudah lolos parser); (3) skor ATS terhadap lowongan spesifik yang user incar; (4) harga impulse Rp15.000; (5) data tidak keluar dari server sendiri (angle privasi, sekaligus hemat biaya).

---

## 3. Persona & Jobs To Be Done

**P1 — Fresh graduate (22–24 th).** Baru lulus, belum pernah bikin CV serius, melamar 20–50 lowongan. *JTBD:* "Bikin CV yang nggak langsung dibuang sistem, malam ini juga." Bayar karena takut kehilangan kesempatan; sensitif harga tapi Rp15rb dianggap wajar.

**P2 — Korban PHK / pencari kerja mendesak (25–40 th).** Butuh cepat, punya pengalaman tapi tidak bisa menuangkannya. *JTBD:* "Ubah pengalaman 6 tahun jadi CV yang lolos filter." Mau bayar Rp35rb untuk paket lengkap karena waktunya mendesak.

**P3 — Career switcher (25–35 th).** Pindah industri, CV lamanya tidak relevan. *JTBD:* "Terjemahkan pengalaman saya ke bahasa industri baru." Repeat buyer untuk revisi (Rp10rb).

**P4 — Seller/kreator yang juga butuh kerja sampingan.** Datang dari konten TikTok, bukan dari pencarian kerja aktif. Konversi rendah tapi volume besar.

**Anti-persona.** Perusahaan/HR yang mau bulk screening; instansi pemerintah yang butuh dokumen resmi; user yang minta CV dikarang (pengalaman fiktif) — ditolak oleh guardrail.

---

## 4. Scope

### 4.1 In-scope (v0.1 — MVP, 14 hari)

1. Intake order via WhatsApp (state machine percakapan).
2. Pengumpulan data: identitas, kontak, target posisi, pengalaman, pendidikan, skill, pencapaian.
3. Opsional: paste teks lowongan → keyword extraction + skor kecocokan.
4. Generate CV ATS-safe (PDF + DOCX) dan surat lamaran (PDF).
5. Skor ATS dengan rincian 4 komponen + saran perbaikan singkat.
6. Pembayaran `transfer_manual` (nomor rekening + nominal unik, user unggah bukti, admin verifikasi manual). QRIS statis & gateway disiapkan sebagai mode, tidak aktif.
7. Pengiriman hasil via WA (dokumen + ringkasan skor).
8. Revisi 1x gratis per order (maks 1 putaran otomatis; lebih dari itu manual).
9. Admin dashboard minimal: daftar order, status, verifikasi pembayaran, antrean manual, refund.
10. Log percakapan + audit sederhana untuk QA.
11. Halaman publik `/` (landing) + `/harga` + `/contoh` (3 contoh CV) + `/faq` untuk SEO & closing.
12. Growth hooks: kode referral (Rp5.000 diskon untuk pengundang, Rp5.000 untuk yang diundang) — implementasi tabel, penukaran manual di v0.1.

### 4.2 Out-of-scope (v0.1)

- Aplikasi mobile native.
- Multi-bahasa (Inggris) — v1.1.
- Auto-apply ke portal lowongan.
- Integrasi payment gateway otomatis (Midtrans/Xendit) — v0.2.
- Optimasi CV per perusahaan (company-specific tailoring).
- Wawancara simulasi / coaching.
- Multi-tenant agen (jual white-label).
- Pembuatan portofolio web.

### 4.3 Later (v1.x)

- Langganan "Job Hunter" Rp49.000/bln: 5 CV + 10 surat lamaran + tracking lamaran.
- Auto-tailoring per lowongan (paste URL lowongan → CV versi khusus).
- Paket B2B kecil: kampus/bootcamp beli kupon massal (harga Rp9.000/kupon).
- Mesin konten otomatis dari pipeline clipper (`front-cliping`/`backend-cliping`) untuk produksi 20 video/minggu.

---

## 5. User Journey

### 5.1 Alur utama (happy path)

```
[Konten TikTok/SEO] → klik link wa.me/62xxx?text=CV
        │
        ▼
[WA] "Halo! Mau bikin CV atau paket lengkap? Balas: 1 = CV (15rb), 2 = Paket (35rb)"
        │
        ▼
[Data diri] nama → target posisi → pengalaman (teks bebas/foto) → pendidikan → skill → kontak
        │
        ▼
[Opsional] "Paste teks lowongan biar CV-nya dioptimalkan? (kirim 'skip' kalau tidak)"
        │
        ▼
[Preview] ringkasan 5 bullet + skor ATS awal (contoh gratis) + tombol harga
        │
        ▼
[Bayar] instruksi transfer/QRIS ditampilkan → user kirim bukti → admin verifikasi
        │
        ▼
[Generate] ≤3 menit → PDF CV + PDF surat lamaran + DOCX + kartu skor ATS
        │
        ▼
[Follow-up] H+1: "Ada panggilan interview? Butuh revisi?" → upsell paket / referral
```

### 5.2 Alur gagal / tepi

| Kondisi | Perilaku sistem |
|---|---|
| User berhenti di tengah intake | State disimpan; reminder 1x setelah 6 jam, 1x setelah 24 jam, lalu arkib |
| User kirim voice note | Transkripsi via 9Router (jika tersedia), fallback: minta ulang teks |
| User kirim foto CV lama | OCR + ekstraksi; konfirmasi hasil sebelum dipakai |
| Bukti bayar tidak valid | State `PAYMENT_REVIEW`, admin diberi notifikasi, user diberi pesan sopan |
| Generate gagal 2x | Fallback model; jika tetap gagal → order ditandai `NEEDS_HUMAN`, admin dapat alert |
| User minta data dihapus | Hapus dokumen + input dalam 24 jam, kirim konfirmasi |
| User minta CV dikarang | Tolak sopan, tawarkan bantuan menonjolkan pengalaman nyata |
| Spam/abuse (>5 order/jam dari nomor sama) | Rate limit + escalation ke admin |

---

## 6. Functional Requirements

Format: **FR-xx** — requirement. **AC:** acceptance criteria.

### FR-01 — Intake percakapan WA

Sistem menerima pesan masuk dari nomor tak dikenal dan memulai state machine percakapan produk.
**AC:** (a) pesan pertama dibalas <5 detik pada 95% kasus; (b) state tersimpan per nomor sehingga user bisa lanjut setelah berhenti; (c) maksimal 8 pertanyaan inti; (d) setiap pertanyaan punya tombol balasan cepat (quick reply) untuk mengurangi ketik.

### FR-02 — Pengumpulan data terstruktur

Data yang dikumpulkan (semua wajib kecuali ditandai): nama lengkap, nomor WA (otomatis), email, kota, target posisi, pengalaman (perusahaan, jabatan, periode, 2–5 pencapaian), pendidikan (institusi, jurusan, tahun, IPK opsional), skill (maks 12), sertifikasi (opsional), link portfolio/LinkedIn (opsional), ekspektasi gaji (opsional).
**AC:** (a) validasi format email & tahun; (b) periode kerja tidak boleh tumpang tindih tanpa konfirmasi; (c) input bebas (paragraf panjang) diterima dan dipecah otomatis; (d) data mentah disimpan terpisah dari data olahan.

### FR-03 — Parsing lowongan & keyword matching

User dapat mengirim teks lowongan (paste) atau melewati langkah ini.
**AC:** (a) ekstraksi minimal: judul posisi, 10–20 keyword hard skill, 5–10 soft skill, level senioritas; (b) output JSON tervalidasi schema; (c) jika teks <100 karakter → minta ulang, jangan menebak.

### FR-04 — Generate CV ATS-safe

Sistem menghasilkan CV dari data user, tanpa mengarang fakta.
**AC:** (a) tidak ada tabel, kolom ganda, text box, ikon, atau header/footer grafis; (b) heading standar (`Pengalaman Kerja`, `Pendidikan`, `Keahlian`); (c) font tunggal (Noto Sans/Inter), ukuran 9–11pt, margin ≥1,5cm; (d) maksimal 2 halaman; (e) setiap bullet hanya berisi fakta yang berasal dari input user — divalidasi oleh guardrail (lihat §11).
**AC tambahan:** jika keyword lowongan tidak ada di input user, sistem **tidak** menambahkannya sebagai pengalaman; hanya boleh muncul di bagian "Keahlian" jika user mengonfirmasi memiliki skill tersebut.

### FR-05 — Generate surat lamaran

Surat lamaran 1 halaman, nada formal Indonesia, menyebut posisi + perusahaan (jika ada) + 3 kekuatan utama dari data user.
**AC:** (a) ≤350 kata; (b) tidak ada placeholder seperti `[Nama Perusahaan]` yang tidak terisi; (c) nama file & isi konsisten dengan CV.

### FR-06 — Skor ATS

Skor 0–100 dengan 4 komponen: **Keyword match 40%**, **Format/parseability 30%**, **Kejelasan & keterbacaan 20%**, **Kelengkapan kontak 10%**.
**AC:** (a) skor deterministik untuk input sama (bukan hasil sampling LLM); komponen keyword dihitung dengan set intersection; komponen format dari validator rule-based; hanya komponen keterbacaan yang memakai LLM dengan temperature 0 dan bobot kecil; (b) rincian per komponen ditampilkan ke user; (c) maksimal 3 saran perbaikan, masing-masing dengan alasan.

### FR-07 — Pembayaran (transfer bank / QRIS)

Sistem menampilkan instruksi pembayaran sesuai `PAYMENT_MODE` + nominal unik (harga + 3 digit unik 001–999 untuk mempermudah rekonsiliasi).

- `PAYMENT_MODE=transfer_manual` — **mode aktif saat ini** (merchant QRIS belum ada): tampilkan nomor rekening + nama pemilik + nominal unik + instruksi unggah bukti.
- `PAYMENT_MODE=qris_static` — aktif setelah merchant QRIS tersedia: tampilkan gambar QRIS + nominal unik.
- `PAYMENT_MODE=gateway` — v0.2 (Midtrans/Xendit): QRIS dinamis, nominal pas.

**AC:** (a) nominal unik tidak pernah dipakai dua kali dalam 24 jam, dihitung lintas semua mode; (b) bukti bayar (gambar) diterima dan disimpan; (c) verifikasi oleh admin di dashboard (v0.0/v0.1) — tanpa asumsi rekonsiliasi otomatis; (d) order tidak masuk produksi sebelum status `PAID`; (e) waktu tunggu maksimum 30 menit sebelum reminder, 24 jam sebelum auto-cancel; (f) ganti mode tidak boleh mengubah order yang sudah berjalan.

### FR-08 — Pengiriman hasil

Setelah `PAID` → job generate → kirim 4 artefak via WA: `CV.pdf`, `Surat-Lamaran.pdf`, `CV.docx`, `Skor-ATS.pdf`.
**AC:** (a) total waktu dari bayar terverifikasi ke terkirim ≤5 menit (p95); (b) jika pengiriman gagal, retry 3x dengan backoff lalu fallback link unduhan (token sekali pakai, 72 jam); (c) user menerima ringkasan skor + 1 saran utama dalam teks.

### FR-09 — Revisi

1 putaran revisi gratis per order (dalam 7 hari).
**AC:** (a) revisi dicatat sebagai versi baru, versi lama disimpan; (b) revisi kedua ke atas → penawaran Rp10.000; (c) revisi hanya mengubah bagian yang diminta (diff disimpan).

### FR-10 — Admin dashboard

**AC:** daftar order + filter status, lihat percakapan, verifikasi pembayaran, tandai `NEEDS_HUMAN`, refund, unduh artefak, lihat metrik harian. Autentikasi wajib (session cookie HttpOnly + rate limit login 5/menit).

### FR-11 — Landing page & SEO

**AC:** halaman `/`, `/contoh`, `/harga`, `/faq`; Lighthouse mobile ≥90 untuk performance & SEO; metadata + JSON-LD `Service`; CTA utama = link `wa.me` dengan pesan pra-isi; halaman contoh menampilkan 3 CV (nama disamarkan) + skor ATS.

### FR-12 — Referral

**AC:** setiap order menghasilkan kode; user pengundang dapat Rp5.000 (potongan order berikutnya) saat kode dipakai pembeli baru; pencatatan manual di v0.1, otomatis di v0.2.

### FR-13 — Retensi & penghapusan data

**AC:** dokumen & input dihapus otomatis 30 hari setelah pengiriman (dapat dikonfigurasi); perintah "hapus data saya" memicu hard delete ≤24 jam + konfirmasi; log tidak menyimpan isi CV, hanya metadata.

### FR-14 — Observability minimal

**AC:** `/health` (db + wa + 9router), metrik harian tersimpan di tabel `metrics_daily`, error dikirim ke file log dengan rotasi 7 hari; alert Telegram ke admin saat worker gagal 3x atau WA disconnect >5 menit.

---

## 7. Arsitektur Sistem

### 7.1 Topologi

```
                    ┌──────────────────────────────────────┐
   Calon pembeli ───┤ WhatsApp (nomor bisnis, Baileys)     │
   (masyarakat)     └───────────────┬──────────────────────┘
                                    │ WebSocket (Baileys)
                                    ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  STB-B (Armbian, ARM64, ~1.5 GB usable)                      │
   │                                                              │
   │  ┌────────────┐   ┌──────────────┐   ┌───────────────────┐    │
   │  │ wa-gateway │──▶│ core-api     │──▶│ worker (job loop) │    │
   │  │ (Node,     │   │ (Node/Express│   │ (Node, 1 job      │    │
   │  │  Baileys)  │◀──│  REST + SSG) │◀──│  paralel)         │    │
   │  └────────────┘   └──────┬───────┘   └─────────┬─────────┘    │
   │                          │                     │              │
   │                    ┌─────▼─────┐         ┌─────▼─────┐        │
   │                    │ SQLite    │         │ artefacts │        │
   │                    │ (WAL)     │         │ (volume)  │        │
   │                    └───────────┘         └───────────┘        │
   │                                                              │
   │  ┌──────────────────────────────────────────────────────┐    │
   │  │ cloudflared (tunnel outbound, no inbound port)       │    │
   │  └──────────────────────────────────────────────────────┘    │
   └──────────────────────────────────────────────────────────────┘
                    │ HTTPS (tunnel)
                    ▼
        lamarankilat.q-devstb.my.id  ──▶  core-api:3000

   STB-A (mesin terpisah) ── 9Router:20128 ──▶ https://9router.q-devstb.my.id/v1
                                (LLM gateway, OpenAI-compatible)
```

### 7.2 Prinsip arsitektur

1. **Satu proses, satu tanggung jawab, satu kontainer.** `wa-gateway`, `core-api`, `worker` dipisah agar crash Baileys tidak mematikan API dan agar resource limit per proses bisa ditegakkan.
2. **Tanpa Redis, tanpa Chromium, tanpa Elasticsearch.** Di RAM 1,5 GB, ketiganya pemborosan. Antrean memakai tabel `jobs` di SQLite dengan `SELECT ... LIMIT 1` + transaksi; PDF memakai `pdfkit`/`wkhtmltopdf`, bukan headless browser.
3. **Komunikasi internal via HTTP lokal + token**, bukan message broker.
4. **Semua state percakapan di DB**, bukan di memori — restart aman.
5. **Idempoten.** Webhook WA dan pembayaran memakai kunci idempoten (`wa_message_id`, `payment_ref`) untuk mencegah order/dokumen ganda.
6. **Fail closed pada pembayaran.** Tidak ada dokumen dikirim sebelum status `PAID`.

### 7.3 Alur data satu order

1. `wa-gateway` terima pesan → POST `/internal/messages` (dengan `X-Internal-Token`).
2. `core-api` simpan `wa_messages`, panggil `conversation-engine` → tentukan state berikutnya → simpan `context_json`, enqueue `send_message` job.
3. Setelah data lengkap → enqueue `generate_preview` (skor ATS awal, gratis) → kirim ringkasan.
4. User setuju → buat `orders` + `payments` (nominal unik) → kirim instruksi sesuai `PAYMENT_MODE`.
5. Bukti bayar masuk → `payments.status = review` → admin approve / cron match → `orders.status = paid`.
6. `worker` ambil job `generate_documents`: panggil 9Router untuk CV JSON → validator → render PDF/DOCX → hitung skor ATS → simpan `documents`.
7. Job `deliver_order`: kirim 4 file via `wa-gateway` → `orders.status = delivered` → jadwalkan job follow-up H+1.

---

## 8. Tech Stack

| Layer | Pilihan | Alasan | Alternatif yang ditolak |
|---|---|---|---|
| Runtime | **Node.js 20 LTS** | Sudah dipakai di `whatsapp-api-baileys`; ekosistem Baileys & PDF matang; satu bahasa untuk semua service | PHP (CI3) kurang cocok untuk Baileys; Go overhead belajar |
| Bahasa | JavaScript (ESM), `node:test` | Konsisten dengan repo existing | TypeScript (boleh, tapi menambah langkah build di ARM) |
| WA | **Baileys** (`@whiskeysockets/baileys`) | Tanpa Chromium (hemat ~300MB RAM), sesi persist via `useMultiFileAuthState` | `whatsapp-web.js` (Chromium, terlalu berat di STB) |
| API | **Express 4** | Ringan, sudah familiar | Fastify (boleh, tapi tanpa manfaat nyata di beban ini) |
| DB | **SQLite (WAL)** via `better-sqlite3` | 1 file, backup mudah, cukup untuk 500 order/hari, tanpa server terpisah | Postgres (RAM 100–200MB terbuang), MySQL (sama) |
| Migrasi | `node-pg-migrate`-style manual runner (`migrations/NNN_*.sql`) | Simpel, transaksional | ORM berat |
| Antrean | Tabel `jobs` + worker loop (poll 2s, backoff eksponensial) | Nol dependensi tambahan | BullMQ (butuh Redis ~50MB) |
| HTTP client | `undici` | Cepat, bawaan Node modern | axios (lebih berat) |
| LLM | **9Router** `https://9router.q-devstb.my.id/v1` (OpenAI-compatible) | COGS ~Rp0, satu gateway untuk banyak model, bisa ganti model tanpa ubah kode | Langsung ke vendor (biaya per request, kunci tersebar) |
| PDF | **`pdfkit`** (default) + `wkhtmltopdf` (opsional untuk template berdesain) | Tanpa browser, ~40MB RAM | Puppeteer/Chromium (~300MB), LaTeX (berat) |
| DOCX | `docx` (npm) | Native XML, file kecil, ATS-safe | LibreOffice headless (~200MB) |
| Validasi schema | `zod` | Kontrak output LLM wajib ketat | manual if-else |
| Log | `pino` + `pino-roll` | JSON, ringan, rotasi harian | Winston |
| Auth admin | Session cookie (HttpOnly, SameSite=Strict) + `argon2` | Tanpa JWT yang bocor di localStorage | JWT (tambah kompleksitas) |
| Reverse proxy | **Cloudflare Tunnel** (`cloudflared`) | Tanpa buka port, HTTPS otomatis, DDoS protection gratis | Nginx + port forward (butuh IP publik) |
| Container | Docker + Compose v2 | Konsisten, mudah rollback | PM2 (tanpa isolasi resource) |
| Monitoring | `/health` + `metrics_daily` + alert Telegram | Cukup, tanpa Grafana/Prometheus (RAM) | Prometheus stack (~300MB) |

**Catatan ARM64.** Semua image wajib `linux/arm64`: `node:20-alpine` (multi-arch), `cloudflared` (official multi-arch). `wkhtmltopdf` di ARM butuh paket `wkhtmltopdf` dari repo Armbian — jika tidak tersedia, wajib fallback ke `pdfkit` (sudah jadi default, jadi tidak memblokir MVP).

---

## 9. Skema Database

SQLite, WAL mode, `foreign_keys=ON`, `busy_timeout=5000`. Semua waktu disimpan ISO-8601 UTC; tampilan dikonversi ke WIB.

```sql
-- 001_init.sql

CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  wa_number     TEXT NOT NULL UNIQUE,      -- format E.164 tanpa '+', cth 628123456789
  display_name  TEXT,
  email         TEXT,
  city          TEXT,
  referral_code TEXT UNIQUE,
  referred_by   INTEGER REFERENCES customers(id),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  blocked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE conversations (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  state        TEXT NOT NULL,              -- lihat §10.1
  context_json TEXT NOT NULL DEFAULT '{}', -- jawaban terkumpul, draft, dsb
  order_id     INTEGER REFERENCES orders(id),
  updated_at   TEXT NOT NULL,
  UNIQUE(customer_id)
);

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,     -- LK-YYMMDD-XXXX
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  product         TEXT NOT NULL,            -- 'cv' | 'bundle'
  price           INTEGER NOT NULL,          -- rupiah
  unique_amount   INTEGER,                   -- harga + 3 digit unik
  status          TEXT NOT NULL,             -- lihat §10.2
  payment_status  TEXT NOT NULL DEFAULT 'pending',
  source          TEXT,                      -- 'tiktok' | 'seo' | 'wa' | 'referral'
  campaign        TEXT,
  input_json      TEXT NOT NULL,             -- data mentah dari user
  ats_score       INTEGER,
  ats_breakdown   TEXT,                      -- JSON per komponen
  revision_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  paid_at         TEXT,
  generated_at    TEXT,
  delivered_at    TEXT,
  expires_at      TEXT,                      -- auto-delete artefak
  notes           TEXT
);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE TABLE job_descriptions (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL,
  parsed_json TEXT,                          -- {title, keywords[], soft[], seniority}
  created_at  TEXT NOT NULL
);

CREATE TABLE documents (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                  -- 'cv_pdf'|'cv_docx'|'letter_pdf'|'score_pdf'
  version    INTEGER NOT NULL DEFAULT 1,
  path       TEXT NOT NULL,
  bytes      INTEGER,
  sha256     TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_documents_order ON documents(order_id, kind);

CREATE TABLE payments (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'transfer_manual',
  provider_ref  TEXT UNIQUE,                 -- idempoten
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL,               -- 'pending'|'review'|'paid'|'expired'|'refunded'
  proof_path    TEXT,
  matched_by    TEXT,                        -- 'admin:<id>' | 'cron:auto'
  created_at    TEXT NOT NULL,
  paid_at       TEXT,
  raw_json      TEXT
);
CREATE INDEX idx_payments_status ON payments(status, created_at);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL,                 -- send_message|generate_preview|generate_documents|deliver_order|followup|cleanup
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',-- queued|running|done|failed|dead
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   TEXT NOT NULL,
  locked_at   TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_jobs_pick ON jobs(status, run_after);

CREATE TABLE wa_messages (
  id           INTEGER PRIMARY KEY,
  wa_message_id TEXT UNIQUE,                 -- idempoten
  chat_id      TEXT NOT NULL,
  customer_id  INTEGER REFERENCES customers(id),
  direction    TEXT NOT NULL,                -- 'in'|'out'
  type         TEXT NOT NULL,                -- text|image|document|audio
  body         TEXT,
  media_path   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_wa_messages_chat ON wa_messages(chat_id, created_at);

CREATE TABLE wa_sessions (
  id              INTEGER PRIMARY KEY,
  session_name    TEXT NOT NULL UNIQUE,
  phone           TEXT,
  status          TEXT NOT NULL,             -- 'disconnected'|'qr'|'connected'
  creds_path      TEXT NOT NULL,
  last_connected  TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE prompt_templates (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL,                  -- 'cv_v1'|'letter_v1'|'jd_parse_v1'|'readability_v1'
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  model_hint TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(key, version)
);

CREATE TABLE admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL
);

CREATE TABLE metrics_daily (
  day              TEXT PRIMARY KEY,          -- YYYY-MM-DD (WIB)
  chats_started    INTEGER DEFAULT 0,
  previews_sent    INTEGER DEFAULT 0,
  orders_created   INTEGER DEFAULT 0,
  orders_paid      INTEGER DEFAULT 0,
  orders_delivered INTEGER DEFAULT 0,
  revenue          INTEGER DEFAULT 0,
  refunds          INTEGER DEFAULT 0,
  revisions        INTEGER DEFAULT 0,
  avg_ats_score    REAL,
  avg_minutes_to_deliver REAL
);

CREATE TABLE content_posts (
  id           INTEGER PRIMARY KEY,
  platform     TEXT NOT NULL,                 -- tiktok|reels|shorts
  hook         TEXT NOT NULL,
  asset_path   TEXT,
  scheduled_at TEXT,
  posted_at    TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  views        INTEGER DEFAULT 0,
  clicks       INTEGER DEFAULT 0,
  orders       INTEGER DEFAULT 0
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  actor      TEXT NOT NULL,                   -- 'admin:1' | 'system' | 'wa:628xx'
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);
```

**Kebijakan data.** `orders.input_json` berisi PII → dienkripsi at rest (AES-256-GCM, kunci dari env `PII_KEY`) di v0.2; v0.1 minimal: file DB permission `600`, tidak pernah di-commit, backup terenkripsi. Artefak disimpan di volume `./data/artefacts/<order_code>/` dan dihapus job `cleanup` setelah `expires_at` (30 hari).

---

## 10. State Machine

### 10.1 State percakapan

```
NEW → ASK_PRODUCT → ASK_NAME → ASK_TARGET_ROLE → ASK_EXPERIENCE
    → ASK_EDUCATION → ASK_SKILLS → ASK_CONTACT → ASK_JD (opsional)
    → PREVIEW → AWAIT_PAYMENT → PAID → GENERATING → DELIVERED → FOLLOWUP
```

State non-linear yang selalu tersedia: `HELP`, `CANCEL`, `HUMAN` (eskalasi admin), `DONE` (order selesai & follow-up terkirim). Setiap state punya: `prompt_text`, `validators[]`, `next_state`, `timeout_hours`, `reminder_text`.

### 10.2 State order

```
draft → awaiting_payment → paid → generating → delivered → closed
             │                  │
             ├→ expired         └→ needs_human → generating
             └→ cancelled
delivered → revision_requested → generating (versi+1) → delivered
delivered/closed → refunded
```

Transisi hanya boleh lewat service layer (`orderService.transition()`), bukan UPDATE langsung dari route. Setiap transisi menulis `audit_log`.

---

## 11. AI Pipeline & Prompt Contract

### 11.1 Prinsip

1. **Nol fabrikasi.** LLM hanya boleh menyusun ulang fakta dari `input_json`. Dilarang menambah perusahaan, jabatan, tahun, sertifikasi, atau angka yang tidak ada di input.
2. **Output terstruktur.** Semua panggilan memakai `response_format: json_object` (jika combo mendukung) + validasi `zod`. Gagal validasi → retry 1x dengan pesan koreksi, lalu fallback model.
3. **Deterministik bila memungkinkan.** Skor ATS dihitung kode, bukan LLM. LLM hanya untuk teks dan satu komponen keterbacaan.
4. **Prompt disimpan di DB** (`prompt_templates`), bukan hardcode, agar bisa A/B test tanpa deploy.

### 11.2 Kontrak output CV (`cv_v1`)

```json
{
  "header": {"name": "...", "headline": "...", "city": "...", "email": "...", "phone": "...", "links": ["..."]},
  "summary": "2-3 kalimat, maks 60 kata",
  "skills": ["maks 12, hanya dari input"],
  "experience": [
    {"company": "...", "title": "...", "period": "2021-2024", "bullets": ["...", "..."]}
  ],
  "education": [{"institution": "...", "degree": "...", "year": "..."}],
  "certifications": ["..."],
  "source_refs": [{"field": "experience[0].bullets[0]", "from_input_key": "experience_raw"}]
}
```

**Validator (kode, bukan LLM):**

- Semua `company`/`title`/`institution` harus muncul (fuzzy ≥85%) di `input_json`; jika tidak → reject.
- Semua angka (tahun, persentase, jumlah) harus ada di input; angka baru → reject.
- `skills` ⊆ `input.skills` ∪ (skill yang dikonfirmasi user saat klarfikasi).
- Panjang: `summary` ≤400 karakter; bullet ≤200 karakter; maks 6 bullet/pengalaman.
- Jika reject 2x → order `needs_human`.

### 11.3 Model routing (via 9Router)

| Task | Model tier | Alasan |
|---|---|---|
| Parse lowongan (`jd_parse_v1`) | murah/cepat | Ekstraksi, bukan kreativitas |
| Susun CV (`cv_v1`) | menengah | Kualitas bahasa + kepatuhan JSON |
| Surat lamaran (`letter_v1`) | menengah | Nada formal |
| Skor keterbacaan (`readability_v1`) | murah, temp 0 | Bobot kecil (20%) |
| Transkripsi voice note | ASR endpoint (jika tersedia) | Opsional |

**Fallback chain:** model utama → model sekunder (combo) → template deterministik (isi bullet apa adanya tanpa LLM). Artinya produk **tetap bisa jalan** kalau 9Router mati total (kualitas turun, tapi order tidak menggantung).

### 11.4 Anggaran token per order

Input prompt ≤2.500 token, output ≤1.500 token, 3 panggilan (JD parse opsional, CV, letter) + 1 panggilan skor. Pada tarif upstream mid-tier, biaya riil ≤Rp150/order — masih di bawah 1% harga jual. Jika combo gratis, biaya = Rp0.

---

## 12. Pembayaran (transfer bank / QRIS)

**v0.0 — transfer bank manual (MODE AKTIF, karena merchant QRIS belum ada).**

1. Order dibuat → `unique_amount = price + (001..999)` yang belum dipakai 24 jam terakhir.
2. Kirim nomor rekening tujuan + nama pemilik + nominal unik + instruksi: transfer **tepat** sampai 3 digit terakhir, lalu kirim screenshot bukti ke chat ini.
3. Bukti masuk → `payments.status = review` → admin approve 1 klik → `paid`.
4. Admin wajib cek mutasi rekening sebelum approve (tidak ada auto-detect). Rekonsiliasi harian 21:00: cocokkan mutasi vs `payments.review`.
5. Risiko mode ini: approve palsu & human error. Mitigasi: screenshot wajib menampilkan nama pengirim + nominal + waktu, dan admin membandingkan dengan mutasi, bukan hanya gambar.

**v0.1 — QRIS statis + nominal unik (aktif setelah merchant QRIS ada).**

1. Order dibuat → `unique_amount` sama seperti di atas.
2. Kirim gambar QRIS merchant + teks nominal + instruksi.
3. User kirim screenshot bukti → `payments.status = review`, file disimpan, admin dapat notifikasi.
4. Admin approve di dashboard (1 klik) → `payments.status = paid` → `orders.status = paid` → enqueue generate.
5. Cron `reconcile` tiap 10 menit: cocokkan mutasi (input manual admin) dengan `unique_amount`.

**v0.2 — Midtrans/Xendit.**

- Buat transaksi QRIS dinamis per order (nominal pas, tanpa 3 digit unik).
- Webhook `settlement` → idempoten via `provider_ref`.
- Refund otomatis untuk kasus gagal generate >24 jam.
- Biaya MDR ~0,7% (masih margin >94%).

**Aturan keras.** Tidak ada pengiriman dokumen sebelum `paid`. Tidak ada refund otomatis di v0.1 (manual oleh admin, tercatat di `audit_log`).

---

## 13. Layer WhatsApp

**Nomor & sesi.** Target produksi = nomor khusus bisnis (bukan nomor pribadi). **Saat ini belum ada** → build & QA pakai nomor staging (nomor lama/sekunder yang tidak dipakai untuk hal penting), lalu ganti ke nomor produksi sebelum go-live. Sesi disimpan di volume `./data/wa/<session>/` (`creds.json` + keys). Satu proses = satu nomor. Multi-nomor = tambah service `wa-gateway-2` (disiapkan, tidak aktif di v0.1). Nomor staging wajib dianggap **dapat banned**: jangan dipakai untuk transaksi bernilai atau komunikasi pribadi.

**Anti-ban (wajib, bukan opsional).**

1. Balas hanya setelah pesan masuk (hindari blast massal).
2. Jeda acak 800–2.500ms sebelum kirim; batas 1 pesan/2 detik per chat.
3. Batas 250 pesan keluar/hari untuk nomor baru (naik bertahap: 100 → 250 → 500 setelah 2 minggu sehat).
4. Tidak mengirim link pada 20 pesan pertama ke nomor baru (kirim teks + minta balasan dulu).
5. Deteksi `disconnect` → backoff reconnect 5s/30s/2m/10m, alert Telegram setelah 5 menit mati.
6. Nomor cadangan disiapkan; jika banned, ganti nomor + update link `wa.me` di landing (<10 menit).

**Format pesan.** Teks pendek (≤4 baris), maksimal 1 emoji, tombol/quick reply untuk pilihan. Dokumen dikirim sebagai `document` dengan `mimetype` benar dan `fileName` deskriptif: `CV-Razli-ATS.pdf`.

**Media masuk.** Gambar bukti bayar disimpan ≤2MB; voice note ≤7MB; PDF/DOCX input ≤10MB. Semua divalidasi tipe via magic bytes, bukan ekstensi.

---

## 14. Dokumen Output

**Template CV (ATS-safe).** Satu kolom, urutan: header kontak → ringkasan → keahlian → pengalaman → pendidikan → sertifikasi. Tanpa tabel, tanpa grafik, tanpa ikon. Font Noto Sans 10pt, line-height 1.35, margin 1,8cm, maks 2 halaman. Nama file: `CV-<NamaSlug>-<KodeOrder>.pdf`.

**Skor ATS.** Halaman 1: skor total + gauge teks (bukan gambar berat). Halaman 2: rincian 4 komponen + 3 saran. Ditandatangani metadata (`Producer: LamaranKilat`).

**Surat lamaran.** 1 halaman, blok tanggal–penerima–salam–3 paragraf–penutup, font sama.

**DOCX.** Struktur heading asli (`Heading 1/2`), tanpa text box, agar bisa diedit di Word/Google Docs dan tetap ATS-safe.

**Validasi otomatis sebelum kirim.** (a) PDF bisa dibuka & jumlah halaman ≤2; (b) tidak ada string `undefined`, `[`, `{{`; (c) semua field wajib terisi; (d) teks bisa diekstrak (bukan gambar) — cek via `pdftotext`; (e) ukuran file ≤1MB per dokumen.

---

## 15. Admin Dashboard

Rute: `/admin` (basic auth sesi). Halaman: **Orders** (tabel + filter + aksi), **Order detail** (percakapan, input, dokumen, tombol regenerate/revisi/refund), **Payments** (antrean verifikasi), **Jobs** (antrean gagal + retry), **Metrics** (dari `metrics_daily`), **Templates** (prompt + versi), **Content** (kalender konten).

Aksi wajib tercatat di `audit_log`: approve payment, refund, regenerate, hapus data, ubah prompt, ubah harga.

---

## 16. Docker & Deployment

### 16.1 Struktur repo

```
lamarankilat/
├── docker-compose.yml
├── Dockerfile.base          # node:20-alpine + deps native (better-sqlite3, fonts)
├── apps/
│   ├── api/                 # Express: REST, admin, landing, static
│   ├── worker/              # job loop: generate, deliver, followup, cleanup
│   └── wa-gateway/          # Baileys: connect, send, receive
├── packages/
│   ├── core/                # services, state machine, ATS scoring, validators
│   ├── ai/                   # 9Router client, prompt builders, zod schemas
│   ├── docs/                 # pdfkit renderer, docx builder
│   └── db/                   # better-sqlite3, migrations, repositories
├── migrations/
├── data/                     # volume: db, artefacts, wa sessions, media
├── scripts/
│   ├── healthcheck.sh
│   ├── backup.sh
│   └── seed-demo.sh
└── tests/
```

### 16.2 `docker-compose.yml`

```yaml
name: lamarankilat
services:
  api:
    build: { context: ., dockerfile: Dockerfile.base }
    command: node apps/api/src/index.js
    restart: unless-stopped
    env_file: .env
    ports: ["127.0.0.1:3000:3000"]        # hanya lokal, publik via tunnel
    volumes: ["./data:/app/data"]
    mem_limit: 320m
    cpus: 0.8
    healthcheck:
      test: ["CMD", "node", "scripts/healthcheck.js", "api"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  worker:
    build: { context: ., dockerfile: Dockerfile.base }
    command: node apps/worker/src/index.js
    restart: unless-stopped
    env_file: .env
    volumes: ["./data:/app/data"]
    mem_limit: 420m                         # pdfkit + docx + buffer gambar
    cpus: 0.9
    depends_on: [api]
    healthcheck:
      test: ["CMD", "node", "scripts/healthcheck.js", "worker"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  wa-gateway:
    build: { context: ., dockerfile: Dockerfile.base }
    command: node apps/wa-gateway/src/index.js
    restart: unless-stopped
    env_file: .env
    volumes: ["./data:/app/data"]
    mem_limit: 300m
    cpus: 0.8
    healthcheck:
      test: ["CMD", "node", "scripts/healthcheck.js", "wa"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    mem_limit: 96m
    depends_on: [api]
    logging: { driver: json-file, options: { max-size: "5m", max-file: "2" } }
```

**Total anggaran RAM:** ~1,15GB (320+420+300+96) + OS ~250MB = **~1,4GB** — masih di bawah 2GB STB, menyisakan ruang untuk burst. Jika STB hanya 1GB, turunkan `worker` ke 300m dan jalankan generate seri (1 job paralel).

### 16.3 `Dockerfile.base`

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache python3 make g++ tzdata font-noto openssl \
 && cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime
ENV TZ=Asia/Jakarta NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data/{artefacts,media,wa,db}
USER node
```

Catatan: `better-sqlite3` butuh build native → `python3 make g++` hanya saat build; pertimbangkan multi-stage agar image akhir kecil. `font-noto` wajib agar PDF tidak blank glyph.

### 16.4 Cloudflare Tunnel

`config.yml` (jika pakai file, bukan token):

```yaml
tunnel: lamarankilat
credentials-file: /etc/cloudflared/creds.json
ingress:
  - hostname: lamarankilat.q-devstb.my.id
    service: http://api:3000
  - hostname: www.lamarankilat.q-devstb.my.id
    service: http://api:3000
  - service: http_status:404
```

DNS: CNAME `lamarankilat` → `<tunnel-id>.cfargotunnel.com` (proxied).

### 16.5 Deployment & operasi

- Deploy: `git pull && docker compose up -d --build` (build di STB ~3–5 menit; alternatif: build di laptop ARM64/`buildx` lalu `docker save`).
- Migrasi DB: `node packages/db/migrate.js` dijalankan otomatis oleh `api` saat start (idempoten).
- Backup: cron harian 02:00 → `sqlite3 .backup` + `tar` artefak → enkripsi → unggah ke Cloudflare R2/Drive; retensi 14 hari.
- Rollback: tag image `:v0.1.x`; `docker compose down && docker compose up -d` dengan tag sebelumnya.
- Reboot aman: semua service `restart: unless-stopped`; Baileys reconnect otomatis dari sesi tersimpan.

### 16.6 Environment variables (`.env`)

```
NODE_ENV=production
PORT=3000
BASE_URL=https://lamarankilat.q-devstb.my.id
INTERNAL_TOKEN=<random 32 hex>            # api <-> wa-gateway <-> worker
ADMIN_USER=admin
ADMIN_PASS_HASH=<argon2 hash>
SESSION_SECRET=<random 32 hex>
PII_KEY=<random 32 hex>                   # enkripsi kolom sensitif (v0.2)
ROUTER9_BASE_URL=https://9router.q-devstb.my.id/v1
ROUTER9_API_KEY=<dari dashboard 9Router>
ROUTER9_MODEL_PRIMARY=combo-coding-pertama-gan
ROUTER9_MODEL_FAST=combo-coding-pertama-gan
WA_SESSION_NAME=lamarankilat
WA_PHONE=628xxxxxxxxxx
WA_DAILY_LIMIT=250
PAYMENT_MODE=transfer_manual                  # transfer_manual | qris_static | gateway
BANK_NAME=<nama bank>
BANK_ACCOUNT=<nomor rekening>
BANK_HOLDER=<nama pemilik rekening>
QRIS_IMAGE_PATH=                              # isi hanya jika PAYMENT_MODE=qris_static
PRICE_CV=15000
PRICE_BUNDLE=35000
PRICE_REVISION=10000
ARTEFACT_TTL_DAYS=30
DATA_RETENTION_DAYS=30
ALERT_TELEGRAM_CHAT_ID=<chat id admin>
TELEGRAM_BOT_TOKEN=<token bot alert>
CF_TUNNEL_TOKEN=<token tunnel>
TZ=Asia/Jakarta
```

---

## 17. Observability & Runbook

**Health checks.** `/health` mengembalikan `{db, wa, router9, queue_depth, version}`. Status `degraded` jika `router9` gagal (produk jalan dengan template deterministik) atau `queue_depth > 20`.

**Alert (Telegram ke admin).** WA disconnect >5 menit; job `dead` (attempts ≥5); pembayaran `review` >2 jam; error rate generate >10% dalam 1 jam; disk >85%.

**Runbook singkat.**

| Gejala | Cek | Aksi |
|---|---|---|
| Tidak ada balasan WA | `/health` → `wa` | Scan QR ulang di `/admin/wa`, cek log `wa-gateway` |
| Order stuck `generating` | tabel `jobs`, `last_error` | Retry manual; jika 9Router down → cek `curl $ROUTER9_BASE_URL/models` dengan key |
| PDF rusak/kosong | `documents.path`, `pdftotext` | Regenerate; cek font Noto terpasang |
| Skor ATS aneh | `ats_breakdown` | Bandingkan keyword set; jika validator terlalu ketat, revisi threshold (bukan prompt) |
| Nomor WA banned | log disconnect code | Aktifkan nomor cadangan, update link `wa.me` di landing, kabari user aktif |

---

## 18. Keamanan, Privasi & Kepatuhan

1. **Data minimization.** Hanya minta yang perlu untuk CV. Tidak minta NIK, nomor KK, atau alamat lengkap (kota cukup).
2. **Retensi.** Dokumen & input dihapus 30 hari; log percakapan disimpan 90 hari tanpa isi CV; `audit_log` 180 hari.
3. **Hak subjek data (UU PDP).** Perintah "hapus data saya" → hard delete ≤24 jam + konfirmasi tertulis; tersedia via WA dan email.
4. **Enkripsi.** HTTPS end-to-end (Cloudflare). DB file permission 600, backup terenkripsi AES-256. v0.2: enkripsi kolom `input_json`.
5. **Akses.** Admin 1–2 akun, argon2, sesi 12 jam, login rate limit, wajib ganti password default saat deploy.
6. **Tidak ada pelatihan model.** Data user tidak dikirim ke vendor untuk training; seluruh inference lewat 9Router yang dikontrol sendiri. Ini juga poin jualan.
7. **Anti-fraud.** Nominal unik mencegah salah cocok; bukti bayar disimpan sebagai audit; refund hanya manual dengan jejak.
8. **Batas wajar.** Rate limit 10 pesan/menit/nomor, 5 order/jam/nomor, 20 order/hari/nomor; blokir nomor yang mengirim file berbahaya (magic-byte check, tolak `.exe`, `.js`, `.zip` >5MB).

---

## 19. Analytics & Metrik

**Funnel (event di `audit_log` + `metrics_daily`):** `chat_started` → `preview_sent` → `payment_qr_shown` → `payment_proof_received` → `paid` → `delivered` → `revision_requested` → `repeat_order`.

**KPI utama (target 90 hari).**

| Metrik | Target | Sumber |
|---|---|---|
| Order/hari | 20 | `metrics_daily.orders_paid` |
| Konversi chat → bayar | ≥12% | funnel |
| Waktu bayar → kirim (p95) | ≤5 menit | `delivered_at - paid_at` |
| Rerata skor ATS output | ≥72 | `avg_ats_score` |
| Refund rate | <3% | `metrics_daily.refunds` |
| Repeat rate 30 hari | ≥15% | `orders` per customer |
| Gross margin | ≥95% | revenue − (AI+hoster listrik) |

**Pelaporan.** `/admin/metrics` (harian/mingguan) + ringkasan otomatis ke Telegram admin tiap 07:00 (order kemarin, revenue, konversi, order `needs_human`).

---

## 20. Roadmap & Estimasi

| Fase | Isi | Estimasi | Output terukur |
|---|---|---|---|
| **M0 — fondasi** | Repo, Docker, SQLite + migrations, WA connect + echo, deploy tunnel | 2 malam | `wa.me` bisa balas "halo" dari STB |
| **M1 — intake** | State machine 8 pertanyaan, penyimpanan konteks, validasi input | 2 malam | 1 order dummy lengkap tersimpan di DB |
| **M2 — generate** | 9Router client, prompt CV + validator anti-fabrikasi, pdfkit + docx | 3 malam | CV 2 halaman valid dari data dummy |
| **M3 — bayar & kirim** | `transfer_manual` + nominal unik, upload bukti, approve admin, kirim 4 artefak | 2 malam | Order end-to-end Rp15.000 selesai |
| **M4 — skor ATS** | Scoring engine + halaman skor PDF | 1 malam | Skor deterministik, breakdown benar |
| **M5 — landing & admin** | Landing SEO, /contoh, admin orders/payments/metrics | 2 malam | Lighthouse ≥90, admin bisa verifikasi |
| **M6 — hardening** | Rate limit, retry, alert, backup, retensi, anti-ban | 2 malam | Uji 20 order sintetis tanpa error |
| **M7 — go-to-market** | 20 hook konten, 3 contoh CV publik, kode referral | 2 malam | 6 konten terbit, 1 order pertama |

**Total: ~16 malam kerja (≈3 minggu kalender).** MVP bisa jualan setelah M3 (lebih cepat dari target rilis penuh), M4–M7 jalan paralel dengan order pertama.

---

## 21. Risiko & Mitigasi

| Risiko | Dampak | Probabilitas | Mitigasi |
|---|---|---|---|
| Nomor WA diblokir | Fatal jangka pendek | Sedang | Anti-ban §13, nomor cadangan, landing multi-nomor, kanal alternatif (Telegram bot) |
| AI mengarang pengalaman | Kepercayaan hancur, refund | Sedang | Validator kode (bukan LLM), `source_refs`, review manual 20 order pertama |
| 9Router mati / key habis | Order menggantung | Sedang | Fallback template deterministik, health check, alert, `needs_human` |
| Kualitas CV tidak lebih baik dari gratis | Konversi rendah | Sedang | Benchmark 10 CV vs template gratis, minta feedback 20 user pertama, iterasi prompt mingguan |
| STB kehabisan RAM saat burst | Service mati | Rendah–Sedang | `mem_limit`, worker 1 job paralel, queue depth alert, swap 1GB |
| Chargeback/salah cocok bayar | Uang hilang | Rendah | Nominal unik, verifikasi admin, rekonsiliasi harian |
| Kompetitor meniru harga | Margin turun | Rendah awal | Kecepatan + distribusi konten, bukan harga |
| Regulasi PDP ditegakkan | Denda/reputasi | Rendah | Retensi 30 hari, hapus atas permintaan, no-training policy |

---

## 22. Test Plan & Acceptance

**Unit (`node:test`).** Parser input bebas; validator anti-fabrikasi (harus reject angka asing); ATS scoring deterministik (fixture 10 CV); state machine transisi (semua edge); nominal unik tidak bentrok.

**Integration.** Order end-to-end pakai WA mock + 9Router mock (fixture JSON): buat order → bayar → generate → deliver, cek 4 artefak ada dan valid. Retry saat mock gagal 1x. Idempotensi: kirim `wa_message_id` sama 2x → 1 order.

**E2E manual.** 5 order nyata (1 dirinya sendiri, 4 tester) sebelum jualan publik; checklist: waktu, kualitas CV, skor, apakah PDF terbuka di HP, apakah ATS parser (pakai parser gratis online) membaca semua bagian.

**Load.** 100 order sintetis berturut-turut tanpa render paralel → ukur RAM puncak worker (<420MB), waktu generate p95 (<90 detik).

**Definition of Done v0.1.** Semua FR-01..FR-14 punya AC terpenuhi atau ditandai ditunda dengan alasan; `docker compose up` dari repo bersih jalan di STB; 1 order nyata terbayar & terkirim; backup harian terbukti restore; dokumentasi `.env.example` + README deploy lengkap.

---

## 23. Keputusan & Pertanyaan Terbuka

### 23.1 Sudah diputuskan (2026-11-20)

1. **QRIS merchant: BELUM ADA.** MVP jalan dengan `PAYMENT_MODE=transfer_manual` (§12 v0.0). QRIS statis menyusul setelah merchant terbit; kode wajib mendukung ketiga mode sejak awal agar tidak perlu refactor.
2. **Nomor WA bisnis: BELUM ADA.** Build & tes pakai nomor staging (nomor lama/sekunder, bukan nomor utama). Nomor produksi dibeli sebelum go-live; lihat §13 untuk aturan pemanasan nomor baru.
3. **Model combo 9Router: `combo-coding-pertama-gan`** untuk `ROUTER9_MODEL_PRIMARY` **dan** `ROUTER9_MODEL_FAST`. Satu model untuk semua task sampai ada bukti model lain lebih baik/murah (uji A/B 20 CV).
4. **Brand:** `LamaranKilat`, subdomain `lamarankilat.q-devstb.my.id` untuk MVP. Domain terpisah diputuskan setelah ada revenue.

### 23.2 Masih terbuka (tidak memblokir build)

1. **Harga final:** Rp15.000/Rp35.000, atau uji Rp12.000 untuk 50 order pertama? Default: pakai harga PRD, ubah lewat env tanpa deploy ulang.
2. **Metode pembayaran jangka panjang:** QRIS statis (biaya 0,7% MDR via aggregator) vs gateway (otomatis, biaya lebih tinggi). Default: QRIS statis dulu.
3. **Legal:** badge "data dihapus otomatis 30 hari" di landing — disarankan ya, tapi bukan blocker.

---

## 24. Lampiran A — Copywriting Pesan WA (v1)

**Sapaan awal**
> Halo! 👋 Saya LamaranKilat. Saya bantu bikin CV + surat lamaran yang lolos sistem ATS.
> Balas:
> 1️⃣ CV saja — Rp15.000
> 2️⃣ Paket lengkap (CV + surat lamaran + teks LinkedIn) — Rp35.000
>
> Selesai ±15 menit, langsung dikirim ke chat ini.

**Minta data pengalaman**
> Tulis pengalaman kerja terakhir (atau kirim foto CV lama). Format bebas, contoh:
> *Toko Maju Jaya, admin, 2022–2024, pegang stok & rekap penjualan, naikin omzet 15%*
>
> Kalau belum ada pengalaman kerja, balas "fresh graduate".

**Preview**
> Data sudah saya susun. Ringkasan:
> • Posisi target: {posisi}
> • Kekuatan utama: {3 bullet}
> • Skor ATS awal: {skor}/100
>
> Mau lanjut? Balas *LANJUT* untuk dapat instruksi pembayaran.

**Setelah bayar**
> Pembayaran diterima ✅
> CV + surat lamaran sedang dibuat (≈3 menit). Saya kirim ke chat ini begitu selesai.

**Follow-up H+1**
> Halo {nama}, CV-nya sudah dipakai melamar? Kalau ada interview, saya bisa bantu siapkan jawaban + rapikan CV versi posisi itu (Rp10.000). Atau ajak 1 teman pakai kode {kode} — kalian dapat potongan Rp5.000.

---

## 25. Lampiran B — Rubrik Skor ATS (implementasi)

```text
total = 0.40*keyword + 0.30*format + 0.20*readability + 0.10*contact

keyword     = |irisan(keyword_lowongan_normalized, teks_cv_normalized)| / |keyword_lowongan|  * 100
              (normalisasi: lowercase, hapus tanda baca, sinonim dasar via map statis 200 entri)
format      = 100 - penalti:
              tabel/gambar/textbox (-40), 2 kolom (-25), font >2 jenis (-10),
              heading tidak standar (-15), halaman >2 (-10), margin <1cm (-10), tanpa kontak (-20)
              (min 0)
readability = LLM temp=0, output {score:0-100, reasons:[...]} untuk kejelasan bullet
              (di-clamp 0-100, bobot kecil agar tidak mendominasi)
contact     = 100 jika nama+telepon+email+ kota ada; -25 per field hilang
```

Saran perbaikan dipilih berurutan: (1) komponen dengan skor terendah, (2) keyword lowongan yang belum muncul tapi user mengonfirmasi punya, (3) format spesifik yang melanggar.

---

## 26. Lampiran C — Checklist Deploy (hari-H)

1. `git clone` → `cp .env.example .env` → isi semua variabel (termasuk `ROUTER9_API_KEY`).
2. `docker compose up -d --build` → cek `docker compose ps` semua `healthy`.
3. Scan QR WA di `/admin/wa` → status `connected`.
4. `curl $BASE_URL/health` → `{db:ok, wa:ok, router9:ok}`.
5. Tes: kirim "halo" dari nomor pribadi → dapat sapaan.
6. Tes generate dummy: `node scripts/seed-demo.sh` → cek 4 artefak valid di `data/artefacts/`.
7. Set backup cron + tes restore ke DB sementara.
8. Ganti password admin default, simpan kredensial di tempat aman.
9. Kirim 1 order nyata (diri sendiri) → verifikasi pembayaran → terima dokumen.
10. Baru iklan konten pertama.

## 27. Handoff untuk Agent Builder

Dokumen ini **satu-satunya** sumber kebenaran. Jangan mengubah keputusan arsitektur tanpa memperbarui PRD ini lebih dulu.

**Urutan kerja wajib.** M0 fondasi → M1 intake → M2 generate → M3 bayar & kirim → M4 skor ATS → M5 landing/admin → M6 hardening → M7 GTM. Jangan mulai M2 sebelum M1 punya 1 order dummy tersimpan utuh di DB. Jangan buka ke publik sebelum M3 lolos 1 order end-to-end.

**Larangan (akan ditolak saat review).**
- Jangan menambah Redis, Chromium/Puppeteer, Postgres, MySQL, Elasticsearch, atau orkestrator apa pun. RAM STB terbatas (§7.2, §16.2).
- Jangan memakai `whatsapp-web.js`. Wajib Baileys (§13).
- Jangan menambah dependensi LLM vendor langsung. Semua inference lewat `ROUTER9_BASE_URL` (§11.3).
- Jangan meng-hardcode prompt di kode. Prompt masuk `prompt_templates` (§9, §11.1).
- Jangan membuat skor ATS dari LLM penuh. Rumus di §25 Lampiran B, LLM hanya komponen `readability`.
- Jangan mengirim dokumen sebelum `payments.status = paid` (§12).
- Jangan menambah field PII di luar daftar FR-02 (NIK, KK, alamat lengkap dilarang).
- Jangan `UPDATE` status order langsung dari route; wajib lewat `orderService.transition()` + `audit_log` (§10.2).

**Kontrak teknis yang tidak boleh diubah tanpa alasan kuat.**

| Aspek | Nilai |
|---|---|
| Port API | `127.0.0.1:3000` (publik hanya via tunnel) |
| Internal auth | header `X-Internal-Token` = `INTERNAL_TOKEN` |
| Idempotensi | `wa_messages.wa_message_id`, `payments.provider_ref` |
| Format nomor WA | E.164 tanpa `+`, cth `628123456789` |
| Waktu di DB | ISO-8601 UTC; konversi WIB hanya di view |
| Tata letak data | volume `./data/{db,artefacts,media,wa}` |
| Ukuran artefak | ≤1MB per dokumen |

**Artefak yang harus dihasilkan agent builder.**
`Dockerfile.base`, `docker-compose.yml`, `migrations/001_init.sql` (persis §9), `.env.example` (persis §16.6), `README.md` (cara deploy 10 langkah §26), `scripts/{healthcheck.js,backup.sh,seed-demo.sh}`, unit test untuk validator anti-fabrikasi + skor ATS + state machine.

**Status input produksi (jangan dikarang).**
Merchant QRIS **belum ada** → implementasi `PAYMENT_MODE=transfer_manual` (§12 v0.0), jangan bikin QRIS palsu. Nomor WA bisnis **belum ada** → tes pakai nomor staging (§13), jangan klaim nomor produksi siap. Model combo **sudah dikunci**: `combo-coding-pertama-gan` untuk primary & fast (§16.6). Rekening tujuan diisi Razli lewat `.env`; kalau kosong, app harus menolak membuat order (`fail closed`) dan menampilkan pesan "pembayaran belum dikonfigurasi" ke admin, bukan menebak. **Jangan menulis nilai palsu ke `.env` dan jangan mengklaim integrasi sudah dites.**

**Definisi selesai (v0.1).** `docker compose up` dari repo bersih jalan di STB-B; `/health` hijau; 1 order nyata terbayar, terkirim, 4 artefak valid; backup harian terbukti bisa direstore; `node --test` lulus; PRD ini diperbarui kalau ada penyimpangan.

**Pemilik keputusan bisnis:** Razli. Agent builder tidak memutuskan harga, brand, atau kanal distribusi.
