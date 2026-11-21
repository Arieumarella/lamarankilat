import { escapeHtml, formatRupiah, formatWIB } from '../util.js';
import { config } from '../config.js';
import { statusLabel } from '../services/orders.js';
import { layout } from './layout.js';

function adminShell(title, bodyHtml, active = 'dash') {
  return layout({
    title,
    admin: false,
    active,
    body: `
<nav class="nav"><div class="wrap nav-inner">
  <a class="brand" href="/admin"><span class="dot">LK</span> LamaranKilat Admin</a>
  <div class="nav-links">
    <a href="/admin" class="${active === 'dash' ? 'on' : ''}">Dashboard</a>
    <a href="/admin/orders" class="${active === 'orders' ? 'on' : ''}">Order</a>
    <a href="/admin/payments" class="${active === 'payments' ? 'on' : ''}">Pembayaran</a>
    <a href="/admin/promo" class="${active === 'promo' ? 'on' : ''}">Promo</a>
    <a href="/admin/jobs" class="${active === 'jobs' ? 'on' : ''}">Queue</a>
    <a href="/admin/settings" class="${active === 'settings' ? 'on' : ''}">Sistem</a>
    ${config.simulator.enabled ? '<a href="/simulator">Simulator</a>' : ''}
    <a href="/admin/logout">Keluar</a>
  </div>
</div></nav>
<div class="wrap" style="padding:26px 0 50px">${bodyHtml}</div>`,
  });
}

function badgeFor(status) {
  const kind = ['delivered', 'closed'].includes(status) ? 'good'
    : ['awaiting_payment', 'paid', 'generating', 'revision_requested'].includes(status) ? 'warn'
      : ['cancelled', 'expired', 'refunded'].includes(status) ? 'bad' : 'brand';
  return `<span class="badge ${kind}">${escapeHtml(statusLabel(status))}</span>`;
}

export function loginPage(error = '') {
  return layout({
    title: 'Masuk Admin',
    body: `
<div class="narrow" style="padding:70px 0">
  <div class="card">
    <div class="brand mb"><span class="dot">LK</span> LamaranKilat Admin</div>
    <h2>Masuk</h2>
    ${error ? `<div class="alert bad">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/admin/login">
      <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary" type="submit" style="width:100%">Masuk</button>
    </form>
    <p class="hint">Kredensial dibuat dari ADMIN_USER / ADMIN_PASS saat container pertama kali start.</p>
  </div>
</div>`,
  });
}

function sparkline(days) {
  const points = [...days].reverse();
  if (!points.length) return '<p class="muted">Belum ada data harian.</p>';
  const max = Math.max(1, ...points.map((d) => d.orders_created || 0));
  const w = 560;
  const h = 110;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points.map((d, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((d.orders_created || 0) / max) * (h - 12) - 6).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:110px" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6366f1" stop-opacity=".45"/><stop offset="100%" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>
    <path d="${path} L${w},${h} L0,${h} Z" fill="url(#g)"/>
    <path d="${path}" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>
  <div class="row muted" style="justify-content:space-between;font-size:12px"><span>${escapeHtml(points[0].day)}</span><span>${escapeHtml(points[points.length - 1].day)}</span></div>`;
}

export function dashboardPage({ kpis, metrics, recent, unverified, deadJobs, wa, queue, router, disk, funnel, aiHealth = null, backup = null }) {
  const alerts = [];
  if (unverified.length) alerts.push(`<div class="alert warn">${unverified.length} pembayaran menunggu verifikasi. <a href="/admin/payments">Buka</a></div>`);
  if (deadJobs) alerts.push(`<div class="alert bad">${deadJobs} job gagal permanen di queue. <a href="/admin/jobs">Periksa</a></div>`);
  if (!router.ok) alerts.push(`<div class="alert warn">9Router tidak terhubung — dokumen akan memakai template deterministik. ${escapeHtml(router.error || '')}</div>`);
  if (aiHealth && aiHealth.ok === false) alerts.push(`<div class="alert bad">Probe AI terakhir gagal: ${escapeHtml(aiHealth.detail || '-')} (${escapeHtml(String(aiHealth.at || '').slice(0, 16).replace('T', ' '))} UTC)</div>`);
  if (backup && !backup.fresh) alerts.push(`<div class="alert warn">Belum ada backup database hari ini. Backup terakhir: ${escapeHtml(backup.latest || 'belum pernah')}. <a href="/admin/settings">Cek</a></div>`);
  if (!config.payment.bankAccount && !['qris_static', 'manual_confirm'].includes(config.payment.mode)) alerts.push('<div class="alert bad">Rekening bank belum diisi (BANK_ACCOUNT/BANK_HOLDER). Order baru akan ditolak.</div>');

  return adminShell('Dashboard', `
<h1 style="font-size:26px">Dashboard</h1>
<p class="muted">Ringkasan operasional hari ini (WIB).</p>
${alerts.join('')}
<div class="grid cols-4 mt">
  <div class="card kpi"><span class="label">Order hari ini</span><span class="value">${kpis.ordersToday}</span><span class="sub">${kpis.ordersTotal} total</span></div>
  <div class="card kpi"><span class="label">Pendapatan hari ini</span><span class="value">${formatRupiah(kpis.revenueToday)}</span><span class="sub">${formatRupiah(kpis.revenueTotal)} total</span></div>
  <div class="card kpi"><span class="label">Konversi chat</span><span class="value">${funnel.conversion}%</span><span class="sub">${funnel.paid} bayar / ${funnel.chats} chat</span></div>
  <div class="card kpi"><span class="label">Antrean job</span><span class="value">${queue.depth}</span><span class="sub">${deadJobs} gagal · ${queue.done} selesai</span></div>
</div>
<div class="grid cols-2 mt">
  <div class="card"><div class="between mb"><h3>Order 14 hari</h3><span class="badge brand">${kpis.ordersTotal} total</span></div>${sparkline(metrics)}</div>
  <div class="card"><h3>Status sistem</h3>
    <ul class="list-clean">
      <li><span>WhatsApp gateway</span><span class="badge ${wa.status === 'connected' ? 'good' : wa.enabled ? 'warn' : ''}">${escapeHtml(wa.status)}</span></li>
      <li><span>9Router</span><span class="badge ${router.ok ? 'good' : 'bad'}">${router.ok ? 'terhubung' : 'offline'}</span></li>
      <li><span>Backup DB</span><span class="badge ${backup && backup.fresh ? 'good' : 'warn'}">${backup && backup.latest ? escapeHtml(backup.latest) : 'belum ada'}</span></li>
      <li><span>Auto-hapus data</span><span class="badge">${config.retentionDays} hari</span></li>
      <li><span>Disk data</span><span class="badge">${disk.mb} MB</span></li>
      <li><span>Pembayaran</span><span class="badge ${config.payment.bankAccount || config.payment.qrisImagePath ? 'good' : 'warn'}">${escapeHtml(config.payment.mode)}</span></li>
      <li><span>Versi</span><span class="badge">v${escapeHtml(config.version)}</span></li>
    </ul>
  </div>
</div>
<div class="card mt">
  <div class="between mb"><h3>Order terbaru</h3><a class="btn ghost sm" href="/admin/orders">Semua order</a></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Kode</th><th>Customer</th><th>Produk</th><th>Nilai</th><th>Status</th><th>ATS</th><th>Dibuat</th><th></th></tr></thead>
    <tbody>
      ${recent.length ? recent.map((o) => `<tr>
        <td class="mono">${escapeHtml(o.code)}</td>
        <td>${escapeHtml(o.display_name || o.wa_number)}<br><small class="muted">${escapeHtml(o.wa_number)}</small></td>
        <td>${o.product === 'bundle' ? 'Paket' : o.product === 'revision' ? 'Revisi' : 'CV'}</td>
        <td class="nowrap">${formatRupiah(o.unique_amount || o.price)}</td>
        <td>${badgeFor(o.status)}</td>
        <td>${o.ats_score ? `<span class="badge ${o.ats_score >= 70 ? 'good' : 'warn'}">${o.ats_score}</span>` : '<span class="muted">—</span>'}</td>
        <td class="nowrap muted">${escapeHtml(formatWIB(o.created_at))}</td>
        <td><a class="btn ghost sm" href="/admin/orders/${o.id}">Detail</a></td>
      </tr>`).join('') : '<tr><td colspan="8" class="muted">Belum ada order.</td></tr>'}
    </tbody>
  </table></div>
</div>`);
}

export function ordersPage({ rows, total, status, q }) {
  const options = ['', 'awaiting_payment', 'paid', 'generating', 'delivered', 'needs_human', 'revision_requested', 'cancelled', 'expired'];
  return adminShell('Order', `
<div class="between"><div><h1 style="font-size:26px;margin-bottom:4px">Order</h1><p class="muted">${total} order ditemukan.</p></div>
  <form method="get" class="row" style="gap:8px">
    <input name="q" value="${escapeHtml(q)}" placeholder="Cari kode / nomor" style="max-width:220px">
    <select name="status" style="max-width:190px">
      ${options.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s ? statusLabel(s) : 'Semua status'}</option>`).join('')}
    </select>
    <button class="btn ghost sm">Filter</button>
  </form>
</div>
<div class="card mt"><div class="table-wrap"><table>
  <thead><tr><th>Kode</th><th>Customer</th><th>Produk</th><th>Harga</th><th>Status</th><th>Bayar</th><th>ATS</th><th>Dibuat</th><th></th></tr></thead>
  <tbody>${rows.length ? rows.map((o) => `<tr>
    <td class="mono">${escapeHtml(o.code)}</td>
    <td>${escapeHtml(o.display_name || o.wa_number)}<br><small class="muted">${escapeHtml(o.wa_number)}</small></td>
    <td>${escapeHtml(o.product)}</td>
    <td class="nowrap">${formatRupiah(o.price)}</td>
    <td>${badgeFor(o.status)}</td>
    <td><span class="badge ${o.payment_status === 'paid' ? 'good' : o.payment_status === 'review' ? 'warn' : ''}">${escapeHtml(o.payment_status)}</span></td>
    <td>${o.ats_score ?? '—'}</td>
    <td class="nowrap muted">${escapeHtml(formatWIB(o.created_at))}</td>
    <td><a class="btn ghost sm" href="/admin/orders/${o.id}">Detail</a></td>
  </tr>`).join('') : '<tr><td colspan="9" class="muted">Tidak ada order pada filter ini.</td></tr>'}</tbody>
</table></div></div>`);
}

export function orderPage({ order, customer, input, docs, payments, jobs, audits }) {
  const breakdown = (() => { try { return JSON.parse(order.ats_breakdown || 'null'); } catch { return null; } })();
  return adminShell('Order ' + order.code, `
<div class="between">
  <div><h1 style="font-size:26px;margin-bottom:4px" class="mono">${escapeHtml(order.code)}</h1>
    <p class="muted">${escapeHtml(customer?.display_name || '-')} · ${escapeHtml(customer?.wa_number || '-')} · dibuat ${escapeHtml(formatWIB(order.created_at))}</p></div>
  <div class="row">${badgeFor(order.status)}<span class="badge ${order.payment_status === 'paid' ? 'good' : 'warn'}">${escapeHtml(order.payment_status)}</span><a class="btn ghost sm" href="/admin/orders">Kembali</a></div>
</div>

<div class="grid cols-3 mt">
  <div class="card"><div class="kpi"><span class="label">Produk</span><span class="value" style="font-size:20px">${escapeHtml(order.product)}</span><span class="sub">${formatRupiah(order.price)} · unik ${formatRupiah(order.unique_amount || order.price)}</span></div></div>
  <div class="card"><div class="kpi"><span class="label">Skor ATS</span><span class="value">${order.ats_score ?? '—'}</span><span class="sub">${breakdown ? `keyword ${breakdown.keyword?.score ?? '-'} · format ${breakdown.format?.score ?? '-'}` : 'belum digenerate'}</span></div></div>
  <div class="card"><div class="kpi"><span class="label">Revisi</span><span class="value">${order.revision_count || 0}</span><span class="sub">aktif: ${order.revision_count ? 'ya' : 'tidak'}</span></div></div>
</div>

<div class="grid cols-2 mt">
  <div class="card">
    <h3>Aksi</h3>
    <div class="stack">
      ${['paid', 'generating', 'needs_human'].includes(order.status) ? `<form method="post" action="/admin/orders/${order.id}/regenerate"><button class="btn ghost" style="width:100%">Regenerate dokumen</button></form>` : ''}
      ${['delivered', 'closed'].includes(order.status) ? `<form method="post" action="/admin/orders/${order.id}/redeliver"><button class="btn ghost" style="width:100%">Kirim ulang dokumen</button></form>` : ''}
      ${order.status === 'delivered' ? `<form method="post" action="/admin/orders/${order.id}/close"><button class="btn good" style="width:100%">Tandai selesai</button></form>` : ''}
      ${!['cancelled', 'refunded', 'closed'].includes(order.status) ? `<form method="post" action="/admin/orders/${order.id}/cancel" onsubmit="return confirm('Batalkan order ini?')"><button class="btn bad" style="width:100%">Batalkan order</button></form>` : ''}
    </div>
  </div>
  <div class="card">
    <h3>Input pelanggan</h3>
    <pre class="mono" style="white-space:pre-wrap;max-height:280px;overflow:auto;color:#cbd5e1">${escapeHtml(JSON.stringify(input, null, 2))}</pre>
  </div>
</div>

<div class="card mt">
  <h3>Dokumen</h3>
  ${docs.length ? `<div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Versi</th><th>Ukuran</th><th>Dibuat</th><th></th></tr></thead><tbody>
    ${docs.map((d) => `<tr><td>${escapeHtml(d.kind)}</td><td>v${d.version}</td><td>${Math.round((d.bytes || 0) / 1024)} KB</td><td class="muted">${escapeHtml(formatWIB(d.created_at))}</td>
      <td><a class="btn ghost sm" href="/admin/docs/${d.id}">Unduh</a></td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Belum ada dokumen.</p>'}
</div>

<div class="card mt">
  <h3>Pembayaran</h3>
  ${payments.length ? `<ul class="list-clean">${payments.map((p) => `<li>
    <span>${formatRupiah(p.amount)} · <span class="badge ${p.status === 'paid' ? 'good' : p.status === 'review' ? 'warn' : ''}">${escapeHtml(p.status)}</span><br><small class="muted">${escapeHtml(p.provider)} · ${escapeHtml(p.provider_ref || '')}</small></span>
    <span class="row">${p.proof_path ? `<a class="btn ghost sm" href="/admin/payments/${p.id}/proof">Bukti</a>` : ''}
      ${p.status !== 'paid' ? `<form method="post" action="/admin/payments/${p.id}/approve"><button class="btn good sm">Approve + generate</button></form>` : ''}
    </span></li>`).join('')}</ul>` : '<p class="muted">Belum ada pembayaran.</p>'}
</div>

<div class="grid cols-2 mt">
  <div class="card"><h3>Job terkait</h3>
    ${jobs.length ? `<ul class="list-clean">${jobs.map((j) => `<li><span>#${j.id} ${escapeHtml(j.type)}<br><small class="muted">${escapeHtml(j.last_error || '')}</small></span><span class="badge ${j.status === 'done' ? 'good' : j.status === 'dead' ? 'bad' : 'warn'}">${escapeHtml(j.status)}</span></li>`).join('')}</ul>` : '<p class="muted">Tidak ada job.</p>'}
  </div>
  <div class="card"><h3>Audit</h3>
    ${audits.length ? `<ul class="list-clean">${audits.map((a) => `<li><span>${escapeHtml(a.action)}</span><small class="muted">${escapeHtml(formatWIB(a.created_at))}</small></li>`).join('')}</ul>` : '<p class="muted">Kosong.</p>'}
  </div>
</div>`);
}

export function paymentsPage({ rows, totals }) {
  return adminShell('Pembayaran', `
<h1 style="font-size:26px">Pembayaran</h1>
<p class="muted">${totals.pending} pending · ${totals.review} perlu verifikasi · ${formatRupiah(totals.paidAmount)} terverifikasi.</p>
<div class="card mt"><div class="table-wrap"><table>
  <thead><tr><th>Order</th><th>Customer</th><th>Nominal</th><th>Status</th><th>Bukti</th><th>Waktu</th><th></th></tr></thead>
  <tbody>${rows.length ? rows.map((p) => `<tr>
    <td class="mono"><a href="/admin/orders/${p.order_id}">${escapeHtml(p.order_code)}</a></td>
    <td>${escapeHtml(p.display_name || p.wa_number)}<br><small class="muted">${escapeHtml(p.wa_number)}</small></td>
    <td class="nowrap">${formatRupiah(p.amount)}</td>
    <td><span class="badge ${p.status === 'paid' ? 'good' : p.status === 'review' ? 'warn' : ''}">${escapeHtml(p.status)}</span></td>
    <td>${p.proof_path ? `<a class="btn ghost sm" href="/admin/payments/${p.id}/proof">Lihat</a>` : '<span class="muted">—</span>'}</td>
    <td class="nowrap muted">${escapeHtml(formatWIB(p.created_at))}</td>
    <td class="row nowrap">
      ${p.status !== 'paid' ? `<form method="post" action="/admin/payments/${p.id}/approve"><button class="btn good sm">Approve</button></form>` : ''}
      ${p.status === 'paid' ? `<form method="post" action="/admin/payments/${p.id}/refund" onsubmit="return confirm('Tandai refund?')"><button class="btn bad sm">Refund</button></form>` : ''}
    </td>
  </tr>`).join('') : '<tr><td colspan="7" class="muted">Tidak ada pembayaran menunggu.</td></tr>'}</tbody>
</table></div></div>`);
}

export function jobsPage({ jobs, queue }) {
  return adminShell('Queue', `
<div class="between"><div><h1 style="font-size:26px;margin-bottom:4px">Job queue</h1>
  <p class="muted">${queue.queued} queued · ${queue.running} jalan · ${queue.done} selesai · ${queue.dead} gagal permanen</p></div>
  <form method="post" action="/admin/jobs/expire"><button class="btn ghost sm">Jalankan maintenance</button></form></div>
<div class="card mt"><div class="table-wrap"><table>
  <thead><tr><th>#</th><th>Type</th><th>Status</th><th>Attempt</th><th>Run after</th><th>Error</th><th></th></tr></thead>
  <tbody>${jobs.length ? jobs.map((j) => `<tr>
    <td class="mono">${j.id}</td><td>${escapeHtml(j.type)}</td>
    <td><span class="badge ${j.status === 'done' ? 'good' : j.status === 'dead' ? 'bad' : j.status === 'running' ? 'brand' : 'warn'}">${escapeHtml(j.status)}</span></td>
    <td>${j.attempts}</td><td class="muted nowrap">${escapeHtml(formatWIB(j.run_after))}</td>
    <td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(j.last_error || '')}</td>
    <td>${['dead', 'failed'].includes(j.status) ? `<form method="post" action="/admin/jobs/${j.id}/retry"><button class="btn ghost sm">Retry</button></form>` : ''}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="muted">Queue kosong.</td></tr>'}</tbody>
</table></div></div>`);
}

export function promoPage({ rows = [], flash = {} }) {
  const kindLabel = { fixed: 'nominal', percent: 'persen', referral: 'referral' };
  return adminShell('Promo', `
<h1 style="font-size:26px">Kode Promo &amp; Referral</h1>
<p class="muted">Kode dipakai pelanggan dengan membalas <code class="mono">PAKAI &lt;kode&gt;</code> di WhatsApp.</p>
${flash.ok ? `<div class="alert good">${escapeHtml(flash.ok)}</div>` : ''}
${flash.err ? `<div class="alert bad">${escapeHtml(flash.err)}</div>` : ''}
<div class="grid cols-2 mt">
  <div class="card"><h3>Buat kode baru</h3>
    <form method="post" action="/admin/promo" class="form-grid">
      <label>Kode (kosongkan untuk otomatis <span class="mono">LK...</span>)
        <input name="code" maxlength="20" placeholder="otomatis" autocomplete="off">
      </label>
      <label>Jenis
        <select name="kind">
          <option value="fixed">Potongan nominal (Rp)</option>
          <option value="percent">Potongan persen (%)</option>
        </select>
      </label>
      <label>Nilai <input name="value" type="number" min="1" required value="5000"></label>
      <label>Kuota pemakaian (0 = tanpa batas) <input name="maxUses" type="number" min="0" value="0"></label>
      <label>Maks per pelanggan <input name="perCustomer" type="number" min="1" value="1"></label>
      <label>Berlaku (hari, 0 = tanpa batas) <input name="days" type="number" min="0" value="30"></label>
      <button class="btn">Buat kode</button>
    </form>
  </div>
  <div class="card"><h3>Cara kerja</h3>
    <ul class="list-clean">
      <li><span>Pemakaian</span><span class="mono">PAKAI HEMAT5</span></li>
      <li><span>Referral pelanggan</span><span class="mono">PAKAI REF&lt;kode&gt;</span></li>
      <li><span>Kredit referral</span><span>${formatRupiah(config.referral.credit)} setelah order teman lunas</span></li>
      <li><span>Maks potongan</span><span>${config.referral.maxSharePct}% dari harga</span></li>
      <li><span>Stacking</span><span>1 kode per order</span></li>
    </ul>
  </div>
</div>
<div class="card mt"><h3>Daftar kode (${rows.length})</h3>
${rows.length ? `<div class="table-wrap"><table>
<thead><tr><th>Kode</th><th>Jenis</th><th>Nilai</th><th>Dipakai</th><th>Kuota</th><th>Status</th><th></th></tr></thead>
<tbody>${rows.map((d) => `<tr>
  <td class="mono">${escapeHtml(d.code)}</td>
  <td>${escapeHtml(kindLabel[d.kind] || d.kind)}</td>
  <td>${d.kind === 'percent' ? `${d.value}%` : formatRupiah(d.value)}</td>
  <td>${d.used_count}${d.per_customer ? ` (maks ${d.per_customer}/pelanggan)` : ''}</td>
  <td>${d.max_uses ? d.max_uses : '∞'}</td>
  <td><span class="badge ${d.active ? 'good' : ''}">${d.active ? 'aktif' : 'nonaktif'}</span></td>
  <td>${d.active ? `<form method="post" action="/admin/promo/${d.id}/off"><button class="btn ghost sm">Nonaktifkan</button></form>` : ''}</td>
</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Belum ada kode promo.</p>'}
</div>`);
}

export function settingsPage({ wa, router, disk, counts, envInfo, backup = null }) {
  return adminShell('Sistem', `
<h1 style="font-size:26px">Sistem</h1>
<p class="muted">Status runtime dan konfigurasi yang aman ditampilkan (tanpa rahasia).</p>
<div class="grid cols-2 mt">
  <div class="card"><h3>WhatsApp</h3>
    <ul class="list-clean">
      <li><span>Status</span><span class="badge ${wa.status === 'connected' ? 'good' : 'warn'}">${escapeHtml(wa.status)}</span></li>
      <li><span>Nomor</span><span>${escapeHtml(wa.phone || 'belum diset')}</span></li>
      <li><span>Pesan hari ini</span><span>${wa.sentToday} / ${config.wa.dailyLimit}</span></li>
      <li><span>Terakhir connect</span><span class="muted">${escapeHtml(formatWIB(wa.lastConnected))}</span></li>
    </ul>
    ${wa.qr ? `<div class="alert warn mt">QR aktif — scan di WhatsApp > Perangkat tertaut.<br><code class="mono" style="font-size:10px;word-break:break-all">${escapeHtml(wa.qr.slice(0, 400))}</code></div>` : ''}
    <p class="hint">Aktifkan dengan WA_ENABLED=true lalu restart container.</p>
  </div>
  <div class="card"><h3>9Router</h3>
    <ul class="list-clean">
      <li><span>Status</span><span class="badge ${router.ok ? 'good' : 'bad'}">${router.ok ? 'terhubung' : 'gagal'}</span></li>
      <li><span>Base URL</span><span class="mono">${escapeHtml(config.router9.baseUrl)}</span></li>
      <li><span>Model</span><span class="mono">${escapeHtml(config.router9.modelPrimary)}</span></li>
      <li><span>Fallback</span><span>template deterministik</span></li>
    </ul>
    ${router.error ? `<p class="hint">${escapeHtml(router.error)}</p>` : ''}
  </div>
</div>
<div class="grid cols-2 mt">
  <div class="card"><h3>Data</h3>
    <ul class="list-clean">
      <li><span>Customer</span><span>${counts.customers}</span></li>
      <li><span>Order</span><span>${counts.orders}</span></li>
      <li><span>Dokumen</span><span>${counts.documents}</span></li>
      <li><span>Pesan WA</span><span>${counts.messages}</span></li>
      <li><span>Disk</span><span>${disk.mb} MB</span></li>
      <li><span>Backup terakhir</span><span class="mono">${escapeHtml(backup?.latest || 'belum ada')}${backup?.bytes ? ` · ${Math.round(backup.bytes / 1024)} KB` : ''}</span></li>
    </ul>
    <form method="post" action="/admin/settings/cleanup" class="mt" onsubmit="return confirm('Hapus artefak kedaluwarsa sekarang?')"><button class="btn ghost">Bersihkan data kedaluwarsa</button></form>
    <form method="post" action="/admin/settings/backup" class="mt" onsubmit="return confirm('Jalankan backup database sekarang?')"><button class="btn ghost">Backup database sekarang</button></form>
  </div>
  <div class="card"><h3>Konfigurasi</h3>
    <ul class="list-clean">
      ${envInfo.map(([k, v]) => `<li><span class="muted">${escapeHtml(k)}</span><span class="mono">${escapeHtml(String(v))}</span></li>`).join('')}
    </ul>
  </div>
</div>`);
}
