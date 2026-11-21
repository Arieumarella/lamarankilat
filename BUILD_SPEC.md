# BUILD SPEC — LamaranKilat (implementasi v0.1)

Baca `PRD.md` di direktori ini. PRD adalah sumber kebenaran produk. Dokumen ini menetapkan
keputusan implementasi yang WAJIB dipatuhi agar aplikasi bisa jalan di STB ARM64 dengan RAM 787MB.

## Keputusan deployment yang menimpa PRD (jangan dilanggar)
1. **SATU container, SATU proses Node.** RAM host hanya 787MB dan sudah dipakai ~560MB container lain.
   Jalankan API + worker + WA-gateway sebagai modul dalam satu proses (`src/index.js`). Port publik **8092** (`0.0.0.0:8092`).
   Tulis deviasi ini di `PRD.md` bagian changelog paling atas.
2. **Tanpa Redis, Chromium/Puppeteer, Postgres, MySQL, Elasticsearch.** SQLite `better-sqlite3` (WAL).
3. **Dependensi produksi seminimal mungkin:** `express@4`, `better-sqlite3`, `pdfkit`, `docx`, `zod`.
   Baileys (`@whiskeysockets/baileys`) boleh ada di dependencies tetapi WAJIB di-`import()` dinamis dan
   hanya bila `WA_ENABLED=true`. Jangan pakai argon2/bcrypt native — pakai `node:crypto` `scrypt`.
   Jangan pakai pino/winston — tulis logger JSON kecil sendiri (`src/logger.js`, rotasi harian 7 file).
4. **Semua AI lewat 9Router** (`ROUTER9_BASE_URL`, OpenAI-compatible). Jika API key kosong/invalid/timeout,
   aplikasi HARUS tetap menghasilkan CV+surat lamaran lewat **template deterministik** (fallback), bukan gagal.
   Ini jalur default saat ini karena key 9Router belum valid. Jangan mengarang key.
5. **WhatsApp:** implementasi Baileys (QR via admin `GET /admin/wa`) tetapi default `WA_ENABLED=false`.
   Untuk uji end-to-end tanpa nomor WA, sediakan **Simulator WA** di `/demo` (UI chat) yang memanggil
   pipeline percakapan yang sama persis dengan webhook WA (`POST /internal/messages` + `X-Internal-Token`).
6. **Pembayaran:** `PAYMENT_MODE=transfer_manual` aktif. Jika `BANK_ACCOUNT`/`BANK_HOLDER` kosong,
   pembuatan order GAGAL (fail closed) dengan pesan "pembayaran belum dikonfigurasi" — tampil di admin & simulator.
7. **PII:** jangan tambah field NIK/KK/alamat lengkap. Jangan commit `.env`, `data/`, atau dokumen user.

## Struktur repo (wajib)
```
package.json            # "type":"module", scripts: start, migrate, seed, test, healthcheck
Dockerfile              # multi-stage node:20-alpine, build better-sqlite3, font-noto, non-root, HEALTHCHECK
docker-compose.yml      # 1 service "app", ports "8092:8092", volume ./data:/app/data, mem_limit 400m
.dockerignore  .gitignore  .env.example  README.md  PRD.md
migrations/001_init.sql # skema §9 PRD (semua tabel + index) + 002_*.sql bila perlu
src/index.js            # boot: migrate -> express server -> worker loop -> scheduler
src/config.js  src/logger.js  src/db.js  src/migrate.js  src/util.js
src/services/{customers,conversation,orders,payments,ats,generator,jobs,metrics,referral,retention}.js
src/services/ai/router9.js
src/services/docs/{cvPdf,letterPdf,scorePdf,cvDocx}.js
src/services/wa/{sender,baileys}.js
src/api/{server,public,admin,internal,simulator}.js
src/views/{layout,landing,harga,contoh,faq,demo,admin}.js  # template string functions, escape HTML
src/prompts/{cv_v1,letter_v1,jd_parse_v1,readability_v1}.js # seed ke tabel prompt_templates saat migrate
scripts/{seed-demo.js,healthcheck.js,backup.sh}
tests/{ats.test.js,validators.test.js,state-machine.test.js,payments.test.js,e2e.test.js}
data/{db,artefacts,media,wa}      # dibuat runtime, gitignored
```

## Kontrak teknis
- Nomor WA: E.164 tanpa `+`. Waktu DB: ISO-8601 UTC. Uang: integer rupiah.
- Internal auth: header `X-Internal-Token` = `INTERNAL_TOKEN` untuk `/internal/*`.
- Idempotensi: `wa_messages.wa_message_id` UNIQUE, `payments.provider_ref` UNIQUE.
- Transisi status order HANYA lewat `orderService.transition(id, next, meta)` yang memvalidasi graf §10.2
  dan menulis `audit_log`.
- `GET /health` → `{status:"ok"|"degraded", db, wa, router9, queue_depth, version}`.
- Semua form publik divalidasi server-side (zod), error ditampilkan rapi, tidak ada stack trace ke user.

## Alur percakapan (WA/simulator)
State: `NEW → ASK_PRODUCT → ASK_NAME → ASK_TARGET_ROLE → ASK_EXPERIENCE → ASK_EDUCATION → ASK_SKILLS →
ASK_CONTACT → ASK_JD → PREVIEW → AWAIT_PAYMENT → PAID → GENERATING → DELIVERED → FOLLOWUP`.
Global: `HELP`, `CANCEL`, `HUMAN`, `DONE`.
- Intake maksimal 8 pertanyaan inti, tiap pertanyaan sertakan quick reply (simulator render sebagai tombol).
- `ASK_EXPERIENCE` menerima paragraf bebas / beberapa baris; parser memecah per pengalaman
  (`Perusahaan, jabatan, 2021-2024, pencapaian...`) dan menyimpan mentah + hasil parse.
- `ASK_JD` menerima paste lowongan (`skip` untuk lewati). <100 karakter → minta ulang.
- `PREVIEW` menampilkan ringkasan + skor ATS awal gratis. `LANJUT` → buat order + instruksi transfer.
- Bukti bayar = gambar yang dikirim di state `AWAIT_PAYMENT` → `payments.status='review'` + job notifikasi admin.
- Perintah "hapus data saya" kapan pun → hard delete input+dokumen, konfirmasi.
- Rate limit 10 pesan/menit, 5 order/jam per nomor (in-memory token bucket + audit).

## Generator (kualitas CV)
- Prompt dari tabel `prompt_templates` (bukan hardcode); seed `cv_v1`, `letter_v1`, `jd_parse_v1`, `readability_v1`.
- Output AI divalidasi zod + **validator anti-fabrikasi**: semua company/title/institution harus fuzzy ≥85%
  ada di input; angka (tahun, %, jumlah) harus ada di input; skills ⊆ input; panjang summary ≤400 char,
  bullet ≤200 char, maks 6 bullet/pengalaman. Gagal 2x → `needs_human`.
- Fallback deterministik WAJIB bagus: header dari input, summary 2–3 kalimat yang dirangkai dari target posisi +
  pengalaman nyata + skill, bullet = pencapaian user yang dirapikan (kapitalisasi, tanpa kata "saya" berlebih),
  urutan: Pengalaman → Pendidikan → Keahlian → Sertifikasi. Jangan mengarang fakta.
- PDF: pdfkit, font Noto Sans (fallback Helvetica), A4, margin 1.8cm, 10–11pt, satu kolom, maks 2 halaman,
  heading standar (`Ringkasan`, `Pengalaman Kerja`, `Pendidikan`, `Keahlian`, `Sertifikasi`), tanpa tabel/ikon/gambar.
- DOCX: pakai `docx`, heading asli, tanpa text box.
- PDF skor ATS: halaman 1 skor + bar komponen (gambar vektor sederhana), halaman 2 rincian + maks 3 saran.
- Surat lamaran 1 halaman ≤350 kata, tanpa placeholder `[...]`/`{{`.
- Validasi sebelum kirim: file ada, >1KB, ≤1MB, `pdftotext`-less check (pakai pdfkit metadata + cek tidak ada
  string `undefined`/`[`/`{{` di teks sumber), jumlah halaman ≤2.

## Skor ATS (deterministik, §25 PRD)
`0.40*keyword + 0.30*format + 0.20*readability + 0.10*contact`, dibulatkan. Keyword = irisan
keyword lowongan (dinormalisasi lowercase, sinonim statis ≥60 entri) dengan teks CV. Format = 100 - penalti
rule-based dari struktur CV yang kita hasilkan. Readability: LLM temp 0 bila tersedia, jika tidak pakai
heuristik (rata-rata panjang bullet, kata kerja aktif, keberadaan angka) — tetap deterministik.
Simpan `ats_score` + `ats_breakdown` JSON. Maks 3 saran, tiap saran punya alasan.

## Halaman publik (kualitas komersial, bukan template murahan)
- Mobile-first, tanpa framework CSS (CSS inline di layout), font sistem, warna brand indigo `#4338ca` +
  aksen emerald `#059669`, kontras AA, target sentuh ≥44px.
- `/` hero + masalah/solusi + cara kerja 3 langkah + harga + contoh skor + FAQ singkat + CTA `wa.me`.
- `/harga` 3 paket (CV 15rb, Paket 35rb, Revisi 10rb) + tabel fitur + catatan revisi gratis 1x.
- `/contoh` 3 CV contoh (nama disamarkan: "Rani P.", "Bagus S.", "Dewi A.") + skor ATS + cuplikan bullet.
- `/faq` minimal 10 Q&A accordion `<details>`.
- SEO: `<title>`, meta description, canonical, Open Graph, JSON-LD `Service` + `FAQPage`, `sitemap.xml`, `robots.txt`.
- Semua teks Bahasa Indonesia, profesional, tanpa klaim palsu (jangan tulis "10.000 pengguna").
- CTA `wa.me` pakai `WA_PHONE` dari env; bila kosong, arahkan ke `/demo`.

## Admin dashboard (`/admin`)
Login (scrypt + session cookie HttpOnly SameSite=Strict, 12 jam, rate limit 5/menit), halaman:
Orders (filter status + pencarian), Order detail (input, dokumen, percakapan, aksi regenerate/revisi/refund/
mark needs_human), Payments (antrean review + approve 1 klik + lihat bukti), Jobs (failed/dead + retry),
Metrics (metrics_daily + funnel), Templates (lihat versi prompt, aktif/nonaktif), WA (status + QR bila enabled),
Pengaturan (harga, rekening — read-only dari env, tampilkan status konfigurasi).
Semua aksi tulis `audit_log`. Jangan ada route admin tanpa cek sesi.

## Seed & demo
- Migrasi otomatis saat boot (idempoten).
- Saat tabel admins kosong: buat admin dari `ADMIN_USER` + `ADMIN_PASS` (env), hash scrypt. Jangan hardcode password.
- `npm run seed` (`scripts/seed-demo.js`): buat 3 order contoh selesai (delivered) dengan 4 artefak nyata
  di `data/artefacts/`, supaya `/contoh` bisa menampilkan skor asli dan admin ada data. Idempoten.

## Test (wajib lulus `npm test`)
`node --test`: (1) ATS deterministik + breakdown menjumlah 100%; (2) validator anti-fabrikasi menolak
perusahaan/angka asing; (3) state machine: semua transisi sah & transisi terlarang ditolak + idempoten;
(4) nominal unik tidak bentrok dalam 24 jam; (5) e2e in-process: buat order → approve payment → generate →
deliver, 4 dokumen ada, `orders.status='delivered'`.
Test memakai DB sementara (`DB_PATH=:memory:` atau file tmp) dan tidak butuh jaringan.

## Definition of done
- `docker compose up -d --build` sukses di ARM64, container `healthy`, `curl localhost:8092/health` OK.
- Landing/harga/contoh/faq/demo/admin/login render 200, tidak ada error di log.
- Simulator: alur penuh sampai dokumen terkirim berfungsi (diverifikasi dengan curl/HTTP).
- `npm test` hijau. README berisi 10 langkah deploy + env. Tidak ada secret di repo.
