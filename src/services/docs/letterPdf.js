import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFonts, COLOR } from './fonts.js';

const MARGIN = 56;

export async function renderLetterPdf(letter, outPath, meta = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: letter.subject || 'Surat Lamaran', Producer: 'LamaranKilat', Creator: 'LamaranKilat' },
  });
  const fonts = resolveFonts();
  if (fonts.regular) doc.registerFont('Body', fonts.regular);
  if (fonts.bold) doc.registerFont('BodyBold', fonts.bold);
  const body = fonts.regular ? 'Body' : 'Helvetica';
  const bold = fonts.bold ? 'BodyBold' : 'Helvetica-Bold';

  doc.font(bold).fontSize(12).fillColor(COLOR.ink).text(meta.name || '', { align: 'left' });
  if (meta.contact) doc.font(body).fontSize(9).fillColor(COLOR.muted).text(meta.contact);
  doc.moveDown(0.8);
  doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).lineWidth(1).strokeColor(COLOR.brand).stroke();
  doc.moveDown(1.1);

  if (letter.subject) {
    doc.font(bold).fontSize(11).fillColor(COLOR.ink).text(letter.subject);
    doc.moveDown(0.9);
  }

  for (const block of String(letter.body || '').split(/\n{2,}/)) {
    const clean = block.trim();
    if (!clean) continue;
    const isSig = /^hormat saya,?$/i.test(clean);
    doc.font(isSig ? body : body).fontSize(10.2).fillColor(COLOR.body)
      .text(clean, { align: 'justify', lineGap: 2.6, width: doc.page.width - MARGIN * 2 });
    doc.moveDown(isSig ? 0.2 : 0.85);
  }

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
