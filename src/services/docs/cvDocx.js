import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun, BorderStyle,
} from 'docx';
import { FONT_FAMILY } from './fonts.js';

const FONT = 'Arial'; // ATS paling aman & tersedia di semua Word/Google Docs

function heading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7C9D1', space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, font: FONT, color: '312E81' })],
  });
}

export async function renderCvDocx(cv, outPath) {
  const children = [];
  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: cv.header?.name || '', bold: true, size: 40, font: FONT })],
  }));
  if (cv.header?.headline) {
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: cv.header.headline, size: 22, font: FONT, color: '4338CA' })],
    }));
  }
  const contact = [cv.header?.city, cv.header?.email, cv.header?.phone, ...(cv.header?.links || [])].filter(Boolean).join('  |  ');
  if (contact) {
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: contact, size: 18, font: FONT, color: '4B5563' })],
    }));
  }

  if (cv.summary) {
    children.push(heading('Ringkasan'));
    children.push(new Paragraph({
      spacing: { after: 60 },
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: cv.summary, size: 20, font: FONT })],
    }));
  }

  if (cv.experience?.length) {
    children.push(heading('Pengalaman Kerja'));
    for (const exp of cv.experience) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 0 },
        children: [
          new TextRun({ text: exp.title || '', bold: true, size: 21, font: FONT }),
          new TextRun({ text: exp.period ? `   (${exp.period})` : '', size: 18, font: FONT, color: '6B7280' }),
        ],
      }));
      if (exp.company) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: exp.company, size: 19, font: FONT, italics: false })],
        }));
      }
      for (const b of exp.bullets || []) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 30 },
          children: [new TextRun({ text: b, size: 19, font: FONT })],
        }));
      }
    }
  }

  if (cv.education?.length) {
    children.push(heading('Pendidikan'));
    for (const edu of cv.education) {
      children.push(new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: edu.institution || '', bold: true, size: 20, font: FONT })],
      }));
      const line = [edu.degree, edu.year].filter(Boolean).join('  |  ');
      if (line) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: line, size: 19, font: FONT })],
        }));
      }
    }
  }

  if (cv.skills?.length) {
    children.push(heading('Keahlian'));
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: cv.skills.join('  |  '), size: 19, font: FONT })],
    }));
  }

  if (cv.certifications?.length) {
    children.push(heading('Sertifikasi'));
    for (const c of cv.certifications) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: c, size: 19, font: FONT })],
      }));
    }
  }

  const doc = new Document({
    creator: 'LamaranKilat',
    title: `CV — ${cv.header?.name || ''}`,
    description: `CV ATS-safe (${FONT_FAMILY} reference) dibuat oleh LamaranKilat`,
    sections: [{
      properties: {
        page: { margin: { top: 1020, bottom: 1020, left: 1020, right: 1020 } },
      },
      children,
    }],
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
    },
  });

  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  return { path: outPath, bytes: buffer.length };
}
