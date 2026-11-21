import { escapeHtml } from '../util.js';
import { config } from '../config.js';

const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_COPY = {
  delivered: { label: 'Selesai', cls: 'ok', hint: 'Dokumen siap diunduh. Tersimpan 30 hari ke depan.' },
  closed: { label: 'Selesai', cls: 'ok', hint: 'Dokumen siap diunduh.' },
  generating: { label: 'Sedang dibuat', cls: 'warn', hint: 'Dokumen sedang disiapkan. Halaman ini otomatis diperbarui.' },
  paid: { label: 'Pembayaran diterima', cls: 'warn', hint: 'Dokumen mulai dibuat setelah pembayaran diverifikasi.' },
  awaiting_payment: { label: 'Menunggu pembayaran', cls: 'warn', hint: 'Selesaikan pembayaran sesuai instruksi di WhatsApp.' },
  revision_requested: { label: 'Revisi diproses', cls: 'warn', hint: 'Versi baru sedang dibuat.' },
};

export function portalPage({ order, docs, token, expired = false }) {
  const status = STATUS_COPY[order.status] || { label: order.status, cls: '', hint: '' };
  const docRows = docs.map((doc) => `
    <li class="doc-row">
      <div>
        <strong>${escapeHtml(doc.title || doc.label || doc.kind)}</strong>
        <div class="muted small">${escapeHtml(doc.kind.toUpperCase())} · ${Math.round((doc.bytes || 0) / 1024)} KB</div>
      </div>
      <a class="btn small" href="/pesanan/${encodeURIComponent(order.code)}/file/${doc.id}?t=${encodeURIComponent(token)}">Unduh</a>
    </li>`).join('');

  return `
  <section class="narrow" style="padding:44px 0 64px">
    <div class="row between" style="align-items:flex-start">
      <div>
        <div class="muted small">Pesanan</div>
        <h1 style="font-size:30px;margin:4px 0 6px">${escapeHtml(order.code)}</h1>
        <div class="badge ${status.cls}">${escapeHtml(status.label)}</div>
      </div>
      <div style="text-align:right">
        <div class="muted small">Total</div>
        <div style="font-size:22px;font-weight:700">${rupiah(order.price)}</div>
        ${order.discount_amount > 0 ? `<div class="muted small">Hemat ${rupiah(order.discount_amount)}</div>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <p class="muted" style="margin-top:0">${escapeHtml(status.hint)}</p>
      ${expired ? '<p class="hint">Link ini sudah kedaluwarsa. Balas STATUS di WhatsApp untuk minta link baru.</p>' : ''}
      ${docs.length ? `<ul class="doc-list">${docRows}</ul>` : '<p class="muted">Belum ada dokumen yang bisa diunduh.</p>'}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Butuh perubahan?</h3>
      <p class="muted">Balas <strong>REVISI</strong> di WhatsApp. Revisi pertama gratis untuk paket apa pun.</p>
      <p class="hint">Simpan file sekarang. Dokumen otomatis dihapus 30 hari setelah dibuat demi privasi data.</p>
    </div>
  </section>`;
}

export function legalPage(kind) {
  const pages = {
    privasi: {
      title: 'Kebijakan Privasi',
      body: `
        <h2>Data yang kami simpan</h2>
        <p>Nama, nomor WhatsApp, email, kota, riwayat pendidikan & pekerjaan, serta teks lowongan yang kamu kirim. Semua dipakai hanya untuk membuat CV dan surat lamaran.</p>
        <h2>Berapa lama</h2>
        <p>Data mentah dan dokumen disimpan maksimal ${config.retentionDays} hari, lalu dihapus otomatis. Kamu bisa minta hapus lebih cepat kapan saja.</p>
        <h2>Berbagi ke pihak lain</h2>
        <p>Kami tidak menjual data. Teks dikirim ke penyedia model AI untuk penyusunan kalimat; tanpa nama, nomor telepon, dan email bila tidak diperlukan.</p>
        <h2>Hak kamu</h2>
        <p>Kirim pesan <strong>HAPUS DATA SAYA</strong> di WhatsApp. Semua data dan dokumen akan dihapus permanen dalam waktu singkat.</p>
        <h2>Keamanan</h2>
        <p>Password admin disimpan sebagai hash scrypt. Akses dokumen memakai token acak yang hanya dikirim ke WhatsApp kamu.</p>`,
    },
    syarat: {
      title: 'Syarat & Ketentuan',
      body: `
        <h2>Layanan</h2>
        <p>LamaranKilat membantu menyusun CV dan surat lamaran. Kami tidak menjamin panggilan wawancara atau hasil seleksi tertentu.</p>
        <h2>Kewajiban kamu</h2>
        <p>Data yang kamu berikan harus benar dan milikmu. Kami tidak bertanggung jawab atas isi yang salah karena data keliru dari pengguna.</p>
        <h2>Pembayaran</h2>
        <p>Pembayaran dilakukan setelah kamu melihat preview dan menyetujui. Nominal unik dipakai untuk mencocokkan transfer.</p>
        <h2>Revisi</h2>
        <p>Revisi pertama gratis. Revisi berikutnya dikenakan ${rupiah(config.price.revision)}.</p>
        <h2>Pembatalan & refund</h2>
        <p>Sebelum dokumen dikirim, pembayaran bisa dikembalikan penuh. Setelah dokumen terkirim, refund diberikan bila ada kesalahan sistem yang tidak bisa diperbaiki lewat revisi.</p>`,
    },
    refund: {
      title: 'Kebijakan Refund',
      body: `
        <h2>Kapan uang kembali</h2>
        <ul>
          <li>Dokumen tidak terkirim dalam 24 jam setelah pembayaran diverifikasi.</li>
          <li>Dokumen yang dikirim tidak sesuai data yang kamu berikan dan tidak bisa diperbaiki lewat revisi.</li>
          <li>Kesalahan ganda (double charge) dari sisi sistem.</li>
        </ul>
        <h2>Cara mengajukan</h2>
        <p>Balas <strong>REFUND</strong> di WhatsApp dengan nomor order. Kami tanggapi maksimal 1×24 jam kerja. Dana kembali ke rekening asal dalam 3–7 hari kerja.</p>`,
    },
  };
  const page = pages[kind] || pages.syarat;
  return `
  <section class="narrow legal" style="padding:44px 0 64px">
    <h1 style="font-size:30px;margin-bottom:6px">${escapeHtml(page.title)}</h1>
    <p class="muted small">Terakhir diperbarui: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <div class="card legal-body">${page.body}</div>
    <p class="hint">Pertanyaan? Balas ADMIN di WhatsApp atau email ke ${escapeHtml(config.contactEmail || 'halo@lamarankilat.id')}.</p>
  </section>`;
}
