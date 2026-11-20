export function simulatorPage() {
  return `
<section class="wrap" style="padding:26px 0 12px">
  <div class="between">
    <div>
      <span class="pill">Mode simulasi</span>
      <h1 style="font-size:30px;margin:12px 0 4px">Simulator WhatsApp</h1>
      <p class="muted" style="margin:0">Uji alur lengkap tanpa nomor WhatsApp asli. Pesan yang dikirim di sini tetap tersimpan di database.</p>
    </div>
    <div class="row">
      <input id="phone" value="6281234567890" style="max-width:210px" aria-label="Nomor WhatsApp">
      <button class="btn primary" id="start">Mulai chat</button>
    </div>
  </div>
</section>
<section class="wrap">
  <div class="chat-shell">
    <div class="card chat-list" id="chat-list" style="padding:12px">
      <div class="muted" style="padding:8px">Percakapan</div>
      <div id="conversations"><small class="muted">Belum ada percakapan.</small></div>
    </div>
    <div class="wa">
      <div class="wa-head">
        <div class="wa-avatar">LK</div>
        <div><div style="font-weight:600">LamaranKilat</div><small class="muted" id="wa-state">online · balas otomatis</small></div>
        <div class="row" style="margin-left:auto"><span class="badge" id="state-badge">NEW</span></div>
      </div>
      <div class="wa-body" id="messages"><div class="muted" style="text-align:center;padding-top:40px">Tekan “Mulai chat” untuk mengirim pesan pembuka.</div></div>
      <div class="wa-foot">
        <input id="text" placeholder="Tulis pesan…" autocomplete="off">
        <button class="btn ghost sm" id="proof" title="Simulasi kirim bukti transfer">📎 Bukti</button>
        <button class="btn primary sm" id="send">Kirim</button>
      </div>
    </div>
  </div>
</section>
<script>
const S = { phone: localStorage.getItem('lk_phone') || '6281234567890', since: 0, lastCount: 0 };
const $ = (id) => document.getElementById(id);
$('phone').value = S.phone;

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function render(messages, state) {
  const box = $('messages');
  const list = messages || [];
  if (!list.length) return;
  box.innerHTML = list.map(m => {
    const out = m.direction === 'out';
    const time = new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    let qr = null;
    try { qr = m.quick_replies ? JSON.parse(m.quick_replies) : null; } catch (e) { qr = null; }
    const quick = (out && Array.isArray(qr) && qr.length)
      ? '<div class="quick">' + qr.map(q => '<button type="button">' + esc(q) + '</button>').join('') + '</div>'
      : '';
    if (m.type === 'document') {
      return '<div class="msg ' + (out ? 'out' : 'in') + ' doc">📄 <strong>' + esc(m.text || m.body || 'dokumen') + '</strong><span class="meta">' + time + ' · ' + (m.status || '') + '</span></div>' + quick;
    }
    if (m.type === 'image') {
      return '<div class="msg ' + (out ? 'out' : 'in') + ' doc">🖼️ ' + esc(m.text || m.body || 'Gambar') + '<span class="meta">' + time + '</span></div>' + quick;
    }
    return '<div class="msg ' + (out ? 'out' : 'in') + '">' + esc(m.text || m.body || '') + '<span class="meta">' + time + (out ? ' · ' + (m.status || '') : '') + '</span></div>' + quick;
  }).join('');
  box.scrollTop = box.scrollHeight;
  $('state-badge').textContent = state || '—';
  $('state-badge').className = 'badge ' + (state === 'DELIVERED' || state === 'FOLLOWUP' ? 'good' : state === 'AWAIT_PAYMENT' ? 'warn' : 'brand');
}

function paint(data) {
  render(data.all || data.messages || [], data.state || 'NEW');
  if (Array.isArray(data.conversations)) {
    $('conversations').innerHTML = data.conversations.length
      ? data.conversations.map(c => '<div class="chat-item" data-phone="' + esc(c.wa_number) + '"><div class="num">' + esc(c.display_name || c.wa_number) + '</div><div class="preview">' + esc(String(c.last_message || '').slice(0, 48)) + '</div><small class="muted">' + esc(c.state || 'NEW') + '</small></div>').join('')
      : '<small class="muted">Belum ada percakapan.</small>';
    document.querySelectorAll('.chat-item').forEach(el => el.addEventListener('click', () => {
      S.phone = el.dataset.phone;
      $('phone').value = S.phone;
      localStorage.setItem('lk_phone', S.phone);
      $('messages').innerHTML = '';
      refresh();
    }));
  }
}

async function refresh() {
  const res = await fetch('/api/sim/messages?phone=' + encodeURIComponent(S.phone) + '&since=0');
  const data = await res.json();
  paint(data);
  return data;
}

async function poll() {
  try {
    if (!document.hidden) await refresh();
  } catch (err) { /* diam saat offline sesaat */ }
}

async function send(text) {
  if (!text.trim()) return;
  $('text').value = '';
  try {
    await api('/api/sim/send', { phone: S.phone, text });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

$('send').addEventListener('click', () => send($('text').value));
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter') send($('text').value); });
$('start').addEventListener('click', async () => {
  S.phone = $('phone').value.trim();
  localStorage.setItem('lk_phone', S.phone);
  try {
    await api('/api/sim/start', { phone: S.phone });
    await refresh();
  } catch (err) { alert(err.message); }
});
$('proof').addEventListener('click', async () => {
  try {
    await api('/api/sim/proof', { phone: S.phone });
    await refresh();
  } catch (err) { alert(err.message); }
});
$('messages').addEventListener('click', (e) => {
  const btn = e.target.closest('.quick button');
  if (btn) send(btn.textContent);
});

$('phone').value = S.phone;
refresh().catch(() => {});
setInterval(poll, 2500);
</script>`;
}
