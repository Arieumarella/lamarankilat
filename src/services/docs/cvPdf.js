import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { resolveFonts, COLOR } from './fonts.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 51; // 1.8 cm

/** Tema visual CV. Semua tetap satu kolom & tanpa tabel (ATS-safe). */
export const THEMES = {
  ats: { brand: COLOR.brand, accent: COLOR.accent, titleSize: 10.5, nameSize: 21, bodySize: 9.8, rule: 0.6 },
  modern: { brand: '#0f766e', accent: '#0ea5e9', titleSize: 11, nameSize: 23, bodySize: 9.9, rule: 0.8 },
  executive: { brand: '#1f2937', accent: '#7c2d12', titleSize: 10, nameSize: 20, bodySize: 9.7, rule: 1.4 },
};

export function resolveTheme(name) {
  return THEMES[String(name || 'ats')] || THEMES.ats;
}

function watermark(doc, text) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.save();
    doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.fontSize(46).fillColor('#cbd5e1').opacity(0.35);
    doc.text(text, 40, doc.page.height / 2 - 30, { width: doc.page.width - 80, align: 'center' });
    doc.restore();
    doc.opacity(1);
    doc.switchToPage(range.start + i);
    const bottom = doc.page.height - 45;
    doc.page.margins.bottom = 0;
    doc.fontSize(7.4).fillColor('#94a3b8').text(text, MARGIN, bottom, { width: doc.page.width - MARGIN * 2, align: 'center' });
  }
}

function applyFonts(doc) {
  const fonts = resolveFonts();
  if (fonts.regular) doc.registerFont('Body', fonts.regular);
  if (fonts.bold) doc.registerFont('BodyBold', fonts.bold);
  doc.font(fonts.regular ? 'Body' : 'Helvetica');
  return { hasRegular: Boolean(fonts.regular), hasBold: Boolean(fonts.bold) };
}

function font(doc, f, size) {
  doc.font(f).fontSize(size);
  return doc;
}

function finish(doc, outPath) {
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

function sectionTitle(doc, text, meta) {
  const bottom = doc.page.height - MARGIN;
  if (doc.y > bottom - 120) doc.addPage();
  doc.x = MARGIN;
  doc.moveDown(0.55);
  const theme = meta.theme || THEMES.ats;
  font(doc, meta.hasBold ? 'BodyBold' : 'Helvetica-Bold', theme.titleSize).fillColor(theme.brand).text(text.toUpperCase(), { characterSpacing: 0.6 });
  doc.moveDown(0.2);
  const y = doc.y;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(theme.rule).strokeColor(COLOR.line).stroke();
  doc.moveDown(0.45);
}

function bullet(doc, text, meta) {
  const x = MARGIN + 10;
  doc.circle(MARGIN + 2.5, doc.y + 4.5, 1.5).fillColor(COLOR.muted).fill();
  font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.6).fillColor(COLOR.body)
    .text(text, x, doc.y, { width: doc.page.width - MARGIN - x, align: 'left', lineGap: 1.6 });
  doc.x = MARGIN;
  doc.moveDown(0.18);
}

/**
 * Render CV ATS-safe: satu kolom, tanpa tabel/gambar/ikon.
 * @param {object} cv data CV terstruktur
 * @param {string} outPath target file PDF
 * @param {{template?:string, watermark?:string, scale?:number}} [opts]
 * @returns {Promise<{path:string, bytes:number, pages:number}>}
 */
export async function renderCvPdf(cv, outPath, opts = {}) {
  const theme = resolveTheme(opts.template);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: `CV — ${cv.header?.name || ''}`, Author: cv.header?.name || '', Producer: 'LamaranKilat', Creator: 'LamaranKilat' },
    bufferPages: true,
    ...(opts.scale ? { pdfVersion: '1.3' } : {}),
  });
  const meta = { ...applyFonts(doc), theme };


  const h = cv.header || {};
  font(doc, meta.hasBold ? 'BodyBold' : 'Helvetica-Bold', theme.nameSize).fillColor(COLOR.ink).text(h.name || '', { align: 'left' });
  if (h.headline) {
    doc.moveDown(0.15);
    font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 11).fillColor(COLOR.brand).text(h.headline, { lineGap: 1 });
  }
  doc.moveDown(0.25);
  const contact = [...new Set([h.city, h.email, h.phone, ...(h.links || [])].filter(Boolean).map((v) => String(v).trim()))].join('  ·  ');
  if (contact) font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.2).fillColor(COLOR.muted).text(contact, { lineGap: 1.2 });

  doc.moveDown(0.3);
  const y0 = doc.y;
  doc.moveTo(MARGIN, y0).lineTo(doc.page.width - MARGIN, y0).lineWidth(1.2).strokeColor(COLOR.brand).stroke();
  doc.moveDown(0.2);

  if (cv.summary) {
    sectionTitle(doc, 'Ringkasan', meta);
    font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.8).fillColor(COLOR.body)
      .text(cv.summary, { width: doc.page.width - MARGIN * 2, lineGap: 2.2, align: 'left' });
  }

  if (cv.experience?.length) {
    sectionTitle(doc, 'Pengalaman Kerja', meta);
    for (const exp of cv.experience) {
      const bottom = doc.page.height - MARGIN;
      if (doc.y > bottom - 80) doc.addPage();
      font(doc, meta.hasBold ? 'BodyBold' : 'Helvetica-Bold', 10.4).fillColor(COLOR.ink).text(exp.title || '', { continued: Boolean(exp.period) });
      if (exp.period) font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.2).fillColor(COLOR.muted).text(`   ${exp.period}`);
      if (exp.company) {
        font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.6).fillColor(COLOR.body).text(exp.company);
      }
      doc.moveDown(0.15);
      for (const b of exp.bullets || []) bullet(doc, b, meta);
      doc.moveDown(0.3);
    }
  }

  if (cv.education?.length) {
    sectionTitle(doc, 'Pendidikan', meta);
    for (const edu of cv.education) {
      font(doc, meta.hasBold ? 'BodyBold' : 'Helvetica-Bold', 10.2).fillColor(COLOR.ink).text(edu.institution || '');
      const line = [edu.degree, edu.year].filter(Boolean).join('  ·  ');
      if (line) font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.4).fillColor(COLOR.body).text(line);
      doc.moveDown(0.3);
    }
  }

  if (cv.skills?.length) {
    sectionTitle(doc, 'Keahlian', meta);
    font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 9.8).fillColor(COLOR.body)
      .text(cv.skills.join('  ·  '), { lineGap: 2, width: doc.page.width - MARGIN * 2 });
  }

  if (cv.certifications?.length) {
    sectionTitle(doc, 'Sertifikasi', meta);
    for (const c of cv.certifications) bullet(doc, c, meta);
  }

  const range = doc.bufferedPageRange();
  const pages = range.count;
  for (let i = 0; i < pages; i += 1) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.height - 30;
    doc.page.margins.bottom = 0;
    font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 7.4).fillColor('#9ca3af')
      .text(`${h.name || ''} — halaman ${i + 1} dari ${pages}`, MARGIN, bottom, { width: doc.page.width - MARGIN * 2, align: 'right' });
  }

  if (opts.watermarkLabel) {
    const label = String(opts.watermarkLabel).slice(0, 120);
    const pagesTotal = doc.bufferedPageRange();
    for (let i = 0; i < pagesTotal.count; i += 1) {
      doc.switchToPage(pagesTotal.start + i);
      doc.save();
      doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fontSize(46).fillColor('#cbd5e1').opacity(0.3);
      doc.text(label, 40, doc.page.height / 2 - 30, { width: doc.page.width - 80, align: 'center' });
      doc.restore();
      doc.opacity(1);
      doc.switchToPage(pagesTotal.start + i);
      doc.page.margins.bottom = 0;
      font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 7).fillColor('#94a3b8')
        .text(label, MARGIN, doc.page.height - 45, { width: doc.page.width - MARGIN * 2, align: 'center' });
    }
  }

  if (opts.watermark) {
    const r2 = doc.bufferedPageRange();
    for (let i = 0; i < r2.count; i += 1) {
      doc.switchToPage(r2.start + i);
      doc.page.margins.bottom = 0;
      font(doc, meta.hasRegular ? 'Body' : 'Helvetica', 7).fillColor('#94a3b8')
        .text(opts.watermark, MARGIN, doc.page.height - 45, { width: doc.page.width - MARGIN * 2, align: 'center' });
    }
  }

  const result = await finish(doc, outPath);
  return { ...result, pages };
}
