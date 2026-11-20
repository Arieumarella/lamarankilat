import { escapeHtml } from '../util.js';
import { config } from '../config.js';

export function layout({ title, body, active = '', description = 'CV & surat lamaran siap ATS dalam 15 menit lewat WhatsApp.', admin = false }) {
  const nav = admin ? '' : `
    <nav class="nav"><div class="wrap nav-inner">
      <a class="brand" href="/"><span class="dot">LK</span> LamaranKilat</a>
      <div class="nav-links">
        <a href="/#cara-kerja" class="${active === 'cara' ? 'on' : ''}">Cara kerja</a>
        <a href="/#harga" class="${active === 'harga' ? 'on' : ''}">Harga</a>
        <a href="/cek-ats" class="${active === 'ats' ? 'on' : ''}">Cek Skor ATS</a>
        <a href="/simulator" class="${active === 'sim' ? 'on' : ''}">Simulator</a>
        <a href="/admin" class="${active === 'admin' ? 'on' : ''}">Admin</a>
      </div>
    </div></nav>`;

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · LamaranKilat</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#070b16">
  <link rel="stylesheet" href="/assets/app.css">
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6366f1"/><text x="16" y="22" font-size="14" font-family="Arial" font-weight="bold" fill="white" text-anchor="middle">LK</text></svg>')}">
</head>
<body>
${nav}
${body}
<footer class="footer"><div class="wrap between">
  <div>© ${new Date().getFullYear()} LamaranKilat · v${escapeHtml(config.version)} · dibuat untuk pencari kerja Indonesia</div>
  <div class="row"><a href="/cek-ats">Cek ATS gratis</a><a href="/simulator">Simulator WA</a><a href="/admin">Admin</a></div>
</div></footer>
</body></html>`;
}
