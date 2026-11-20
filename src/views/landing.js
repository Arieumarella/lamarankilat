import { escapeHtml } from '../util.js';
import { config } from '../config.js';

const waLink = (text) => {
  const phone = String(config.wa.phone || '').replace(/[^\d]/g, '');
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '/simulator';
};

export function landingPage() {
  const priceCv = config.price.cv.toLocaleString('id-ID');
  const priceBundle = config.price.bundle.toLocaleString('id-ID');
  return `
<header class="wrap hero">
  <div>
    <span class="pill">⚡ Rata-rata selesai 15 menit · lewat WhatsApp</span>
    <h1>CV yang lolos <span style="background:linear-gradient(135deg,#818cf8,#c084fc);-webkit-background-clip:text;background-clip:text;color:transparent">filter ATS</span>, tanpa ribet.</h1>
    <p class="lead">Kirim data kamu lewat WhatsApp. Kami susun CV + surat lamaran yang ramah robot rekrutmen, lengkap dengan skor ATS dan file Word yang bisa diedit.</p>
    <div class="cta-row">
      <a class="btn primary" href="${waLink('Halo LamaranKilat, saya mau bikin CV')}" target="_blank" rel="noopener">Mulai via WhatsApp</a>
      <a class="btn ghost" href="/cek-ats">Cek skor ATS gratis</a>
    </div>
    <div class="row mt muted" style="font-size:13px">
      <span>✓ Tanpa aplikasi</span><span>✓ Bayar setelah lihat preview</span><span>✓ Revisi pertama gratis</span>
    </div>
  </div>
  <div class="card" style="transform:rotate(-1deg)">
    <div class="between mb"><strong>Preview CV</strong><span class="badge good">ATS 92/100</span></div>
    <div style="border:1px solid var(--line);border-radius:12px;padding:18px;background:#0b1324">
      <div style="font-size:19px;font-weight:700">Rina Ayu Safitri</div>
      <div class="muted" style="font-size:13px">Staff Akuntansi · Malang · rina@email.com</div>
      <div class="bar good mt" style="height:6px"><i style="width:92%"></i></div>
      <div class="mt" style="font-size:13px;line-height:1.7;color:#cbd5e1">
        <strong style="color:#eef2ff">Ringkasan</strong><br>Staff akuntansi dengan 3 tahun pengalaman rekonsiliasi bank dan pelaporan bulanan untuk 4 entitas.
        <div class="mt"><strong style="color:#eef2ff">Pengalaman</strong></div>
        • Merekap 1.200 transaksi/bulan dengan Excel pivot, selisih turun 40%<br>
        • Menyusun laporan pajak bulanan tepat waktu 12 bulan berturut-turut
      </div>
    </div>
    <div class="row mt" style="justify-content:space-between"><small>Dikirim sebagai PDF + DOCX</small><small class="badge brand">±15 menit</small></div>
  </div>
</header>

<section class="wrap" id="cara-kerja">
  <h2>Kenapa CV sering gugur sebelum dibaca manusia?</h2>
  <p class="lead">Lebih dari 70% perusahaan memakai Applicant Tracking System. Sistem ini membaca teks polos — bukan desain. Salah format, keyword tidak cocok, langsung tersaring.</p>
  <div class="grid cols-3 mt">
    <div class="card"><h3>1. Format ramah parser</h3><p class="muted">Satu kolom, heading standar, tanpa tabel/ikon. Font Arial/Noto, margin aman, maksimal 2 halaman.</p></div>
    <div class="card"><h3>2. Keyword dari lowongan asli</h3><p class="muted">Paste teks lowongan, kami petakan keyword yang wajib muncul — tanpa mengarang pengalaman.</p></div>
    <div class="card"><h3>3. Skor terukur, bukan klaim</h3><p class="muted">40% keyword · 30% format · 20% keterbacaan · 10% kelengkapan kontak. Semua transparan di laporan.</p></div>
  </div>
</section>

<section class="wrap mt" style="margin-top:48px">
  <div class="grid cols-3">
    <div class="card"><div class="kpi"><span class="label">Langkah 1</span><span class="value" style="font-size:20px">Chat & jawab 7 pertanyaan</span><span class="sub">Tanpa form panjang. Cukup balas pesan WhatsApp.</span></div></div>
    <div class="card"><div class="kpi"><span class="label">Langkah 2</span><span class="value" style="font-size:20px">Lihat preview + skor</span><span class="sub">Cek dulu sebelum bayar. Bisa revisi data.</span></div></div>
    <div class="card"><div class="kpi"><span class="label">Langkah 3</span><span class="value" style="font-size:20px">Terima 3–4 file</span><span class="sub">CV PDF, CV Word, surat lamaran, laporan ATS.</span></div></div>
  </div>
</section>

<section class="wrap" id="harga" style="margin-top:56px">
  <h2>Harga jelas, tanpa langganan</h2>
  <div class="grid cols-2 mt">
    <div class="card">
      <div class="between"><h3>CV saja</h3><span class="badge brand">Paling laris</span></div>
      <div style="font-size:38px;font-weight:800;letter-spacing:-.03em">Rp${priceCv}</div>
      <p class="muted">Sekali bayar, file jadi milik kamu.</p>
      <ul class="list-clean">
        <li><span>CV PDF siap kirim</span><span class="badge good">✓</span></li>
        <li><span>CV Word bisa diedit</span><span class="badge good">✓</span></li>
        <li><span>Laporan skor ATS + saran</span><span class="badge good">✓</span></li>
        <li><span>Revisi pertama</span><span class="badge good">Gratis</span></li>
      </ul>
      <a class="btn primary mt" style="width:100%" href="${waLink('Halo, saya mau paket CV saja')}" target="_blank" rel="noopener">Pilih CV saja</a>
    </div>
    <div class="card">
      <div class="between"><h3>Paket lengkap</h3><span class="badge warn">Paling hemat</span></div>
      <div style="font-size:38px;font-weight:800;letter-spacing:-.03em">Rp${priceBundle}</div>
      <p class="muted">Untuk lamaran yang benar-benar serius.</p>
      <ul class="list-clean">
        <li><span>Semua isi paket CV</span><span class="badge good">✓</span></li>
        <li><span>Surat lamaran PDF (1 halaman)</span><span class="badge good">✓</span></li>
        <li><span>Draf pesan LinkedIn / email rekruter</span><span class="badge good">✓</span></li>
        <li><span>Revisi pertama</span><span class="badge good">Gratis</span></li>
      </ul>
      <a class="btn primary mt" style="width:100%" href="${waLink('Halo, saya mau paket lengkap')}" target="_blank" rel="noopener">Pilih paket lengkap</a>
    </div>
  </div>
</section>

<section class="wrap" style="margin-top:56px">
  <div class="card">
    <h2>Pertanyaan yang sering muncul</h2>
    <div class="grid cols-2 mt">
      <div><h3>Apa itu ATS?</h3><p class="muted">Software yang dipakai HR untuk menyaring lamaran otomatis. Ia membaca teks, jadi format dan keyword menentukan kamu lolos atau tidak.</p></div>
      <div><h3>Apakah data saya aman?</h3><p class="muted">Data hanya dipakai untuk membuat dokumen. File otomatis dihapus 30 hari, dan kamu bisa minta hapus kapan saja dengan menulis HAPUS DATA SAYA.</p></div>
      <div><h3>Bisa bayar pakai QRIS?</h3><p class="muted">Bisa, tergantung pengaturan admin. Instruksi lengkap dikirim di chat setelah kamu setuju dengan preview.</p></div>
      <div><h3>Kalau hasilnya kurang cocok?</h3><p class="muted">Revisi pertama gratis. Revisi berikutnya Rp${config.price.revision.toLocaleString('id-ID')} per dokumen.</p></div>
    </div>
  </div>
</section>

<section class="wrap" style="margin-top:40px">
  <div class="card between" style="background:linear-gradient(135deg,rgba(99,102,241,.22),rgba(139,92,246,.12))">
    <div><h2 style="margin-bottom:6px">Siap bikin CV yang dibaca robot dan manusia?</h2><p class="muted" style="margin:0">Mulai dari chat, selesai dalam 15 menit.</p></div>
    <a class="btn primary" href="${waLink('Halo LamaranKilat')}" target="_blank" rel="noopener">Chat sekarang</a>
  </div>
</section>`;
}

export function atsPage() {
  return `
<section class="narrow" style="padding:48px 0 24px">
  <span class="pill">Gratis · tanpa daftar</span>
  <h1 style="font-size:36px;margin-top:14px">Cek skor ATS CV kamu</h1>
  <p class="lead">Tempel isi CV (teks) dan teks lowongan. Kami hitung dengan rumus yang sama seperti dokumen LamaranKilat: 40% keyword, 30% format, 20% keterbacaan, 10% kontak.</p>
</section>
<section class="narrow">
  <div class="card">
    <form id="ats-form">
      <div class="field"><label for="cv">Isi CV (copy-paste teks)</label>
        <textarea id="cv" name="cv" style="min-height:180px" placeholder="Rina Ayu Safitri&#10;Staff Akuntansi · Malang&#10;rina@email.com · 0812xxxxxxx&#10;&#10;RINGKASAN&#10;...&#10;&#10;PENGALAMAN&#10;• ..." required></textarea></div>
      <div class="field"><label for="jd">Teks lowongan (opsional, tapi sangat disarankan)</label>
        <textarea id="jd" name="jd" style="min-height:120px" placeholder="Kualifikasi: minimal 2 tahun pengalaman akuntansi, menguasai Excel, ..."></textarea></div>
      <div class="row"><button class="btn primary" type="submit">Hitung skor</button><span class="muted" id="ats-status"></span></div>
    </form>
    <div id="ats-result" class="mt"></div>
  </div>
</section>
<script>
const form = document.getElementById('ats-form');
const out = document.getElementById('ats-result');
const status = document.getElementById('ats-status');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'Menghitung...';
  out.innerHTML = '';
  try {
    const res = await fetch('/api/public/score', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cv: form.cv.value, jd: form.jd.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal menghitung');
    const tone = data.total >= 70 ? 'good' : data.total >= 55 ? 'warn' : 'bad';
    out.innerHTML = \`
      <div class="card" style="background:var(--panel-2)">
        <div class="score-ring">
          <div class="ring" style="--p:\${data.total}"><span>\${data.total}</span></div>
          <div>
            <h3 style="margin-bottom:4px">\${data.band}</h3>
            <div class="muted">\${data.words} kata · \${data.jd_used ? 'dibandingkan dengan lowongan' : 'tanpa teks lowongan'}</div>
            <div class="row mt" style="gap:16px;font-size:13px">
              <span>Keyword <strong>\${data.keyword}</strong></span>
              <span>Format <strong>\${data.format}</strong></span>
              <span>Keterbacaan <strong>\${data.readability}</strong></span>
              <span>Kontak <strong>\${data.contact}</strong></span>
            </div>
          </div>
        </div>
        \${data.issues.length ? '<h3 class="mt">Yang perlu diperbaiki</h3><ul class="list-clean">' + data.issues.map(i => '<li><span>' + i + '</span></li>').join('') + '</ul>' : '<p class="mt">Struktur CV sudah rapi. Fokus ke penyesuaian keyword per lowongan.</p>'}
        \${data.missing_keywords.length ? '<h3 class="mt">Keyword lowongan yang belum muncul</h3><div class="row">' + data.missing_keywords.map(k => '<span class="badge warn">' + k + '</span>').join('') + '</div>' : ''}
        \${data.matched_keywords.length ? '<h3 class="mt">Keyword yang sudah cocok</h3><div class="row">' + data.matched_keywords.map(k => '<span class="badge good">' + k + '</span>').join('') + '</div>' : ''}
        <div class="alert ok mt">Mau versi rapi + file siap kirim? <a href="/simulator">Coba simulator</a> atau chat admin WhatsApp.</div>
      </div>\`;
    status.textContent = '';
  } catch (err) {
    status.textContent = '';
    out.innerHTML = '<div class="alert bad">' + (err.message || 'Gagal') + '</div>';
  }
});
</script>`;
}
