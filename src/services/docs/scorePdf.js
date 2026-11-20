import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFonts, COLOR } from './fonts.js';
import { atsBand } from '../ats.js';

const MARGIN = 56;

const TONE = {
  good: '#059669', ok: '#0d9488', warn: '#d97706', bad: '#dc2626',
};

export async function renderScorePdf({ score, order, cv, letter }, outPath) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: `Skor ATS — ${order.code}`, Producer: 'LamaranKilat', Creator: 'LamaranKilat' },
    bufferPages: true,
  });
  const fonts = resolveFonts();
  if (fonts.regular) doc.registerFont('Body', fonts.regular);
  if (fonts.bold) doc.registerFont('BodyBold', fonts.bold);
  const body = fonts.regular ? 'Body' : 'Helvetica';
  const bold = fonts.bold ? 'BodyBold' : 'Helvetica-Bold';
  const band = atsBand(score.total);
  const tone = TONE[band.tone] || COLOR.brand;

  doc.font(bold).fontSize(9.5).fillColor(COLOR.brand).text('LAMARANKILAT', { characterSpacing: 1.2 });
  doc.moveDown(0.25);
  doc.font(bold).fontSize(20).fillColor(COLOR.ink).text('Laporan Skor ATS');
  doc.font(body).fontSize(9.4).fillColor(COLOR.muted)
    .text(`${cv.header?.name || ''} · ${order.code} · ${new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' })}`);

  doc.moveDown(1.4);
  const cx = doc.page.width / 2;
  const cy = doc.y + 78;
  const r = 66;
  doc.lineWidth(13).strokeColor('#e5e7eb').circle(cx, cy, r).stroke();
  const pct = Math.max(0, Math.min(100, score.total)) / 100;
  doc.lineWidth(13).strokeColor(tone);
  doc.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct).stroke();
  doc.font(bold).fontSize(34).fillColor(COLOR.ink).text(String(score.total), cx - 40, cy - 18, { width: 80, align: 'center' });
  doc.font(body).fontSize(8.5).fillColor(COLOR.muted).text('dari 100', cx - 40, cy + 18, { width: 80, align: 'center' });
  doc.font(bold).fontSize(11).fillColor(tone).text(band.label, cx - 80, cy + r + 16, { width: 160, align: 'center' });

  doc.y = cy + r + 52;
  doc.x = MARGIN;

  const comps = [
    ['keyword', 'Kecocokan keyword', 0.40],
    ['format', 'Format & parseability', 0.30],
    ['readability', 'Kejelasan & keterbacaan', 0.20],
    ['contact', 'Kelengkapan kontak', 0.10],
  ];
  const barW = doc.page.width - MARGIN * 2 - 150;
  for (const [key, label, weight] of comps) {
    const c = score.components[key] || { score: 0 };
    const y = doc.y;
    doc.font(body).fontSize(9.5).fillColor(COLOR.body).text(label, MARGIN, y, { width: 190 });
    doc.font(bold).fontSize(9.5).fillColor(COLOR.ink).text(`${c.score}/100`, MARGIN + 190, y, { width: 60, align: 'right' });
    doc.font(body).fontSize(8).fillColor(COLOR.muted).text(`bobot ${Math.round(weight * 100)}%`, MARGIN + 255, y + 1);
    const bx = MARGIN + 330;
    doc.rect(bx, y + 2, barW, 7).fill('#e5e7eb');
    doc.rect(bx, y + 2, Math.max(2, (barW * c.score) / 100), 7).fill(tone);
    doc.y = y + 22;
  }

  doc.addPage();
  doc.font(bold).fontSize(14).fillColor(COLOR.ink).text('Rincian per komponen');
  doc.moveDown(0.6);
  for (const [key, label] of comps) {
    const c = score.components[key] || {};
    doc.font(bold).fontSize(10.5).fillColor(COLOR.brand).text(`${label} — ${c.score}/100`);
    doc.font(body).fontSize(9.4).fillColor(COLOR.body).text(c.note || '', { lineGap: 1.6 });
    if (c.matched_terms?.length) doc.font(body).fontSize(8.8).fillColor(COLOR.muted).text(`Cocok: ${c.matched_terms.join(', ')}`);
    if (c.missing_terms?.length) doc.font(body).fontSize(8.8).fillColor(TONE.warn).text(`Belum muncul: ${c.missing_terms.join(', ')}`);
    if (c.penalties?.length) doc.font(body).fontSize(8.8).fillColor(COLOR.muted).text(c.penalties.join(' · '));
    doc.moveDown(0.7);
  }

  doc.moveDown(0.4);
  doc.font(bold).fontSize(12).fillColor(COLOR.ink).text('Saran perbaikan');
  doc.moveDown(0.35);
  const suggestions = score.suggestions?.length ? score.suggestions : [{ text: 'Pertahankan format satu kolom dan lengkapi pencapaian dengan angka.', reason: 'Format sudah ATS-safe.' }];
  suggestions.slice(0, 3).forEach((s, i) => {
    doc.font(bold).fontSize(9.6).fillColor(COLOR.body).text(`${i + 1}. ${s.text}`, { lineGap: 1.6 });
    doc.font(body).fontSize(8.6).fillColor(COLOR.muted).text(`Alasan: ${s.reason}`, { indent: 12 });
    doc.moveDown(0.4);
  });

  doc.moveDown(1.2);
  doc.font(body).fontSize(8).fillColor('#9ca3af')
    .text('Skor dihitung deterministik dari kecocokan keyword, struktur dokumen, keterbacaan, dan kelengkapan kontak. '
      + 'Dokumen ini bukan jaminan lolos seleksi, melainkan alat perbaikan berbasis aturan parser ATS umum.', { lineGap: 1.4 });

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      resolve({ path: outPath, bytes: buf.length });
    });
    doc.on('error', reject);
    doc.end();
  });
}
