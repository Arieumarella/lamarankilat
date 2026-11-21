import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { nowIso, slugify, sha256File, truncate } from '../util.js';
import { generateCv, generateLetter, parseJobDescription } from './generator.js';
import { computeAtsScore, atsBand } from './ats.js';
import { renderCvPdf } from './docs/cvPdf.js';
import { renderCvDocx } from './docs/cvDocx.js';
import { renderLetterPdf } from './docs/letterPdf.js';
import { renderScorePdf } from './docs/scorePdf.js';
import { orderInput } from './orders.js';

export const MAX_BYTES = 1024 * 1024; // batas dokumen WhatsApp

function outputDir(code, version) {
  const dir = path.join(config.artefactDir, code, `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileNames(name, code) {
  const slug = slugify(name || 'pelamar', 'pelamar');
  return {
    cvPdf: `CV-${slug}-${code}.pdf`,
    cvDocx: `CV-${slug}-${code}.docx`,
    letterPdf: `Surat-Lamaran-${slug}-${code}.pdf`,
    scorePdf: `Skor-ATS-${code}.pdf`,
    linkedinTxt: `Teks-LinkedIn-${slug}-${code}.txt`,
  };
}

/** Teks profil LinkedIn siap tempel (bagian dari paket bundle). */
function buildLinkedinText(cv, input, jd) {
  const name = cv.header?.name || input.name || 'Nama Anda';
  const headline = cv.header?.headline || input.target_role || 'Profesional';
  const skills = (cv.skills || []).slice(0, 15).join(', ');
  const about = [
    `${headline} dengan fokus pada hasil terukur.`,
    cv.summary || '',
    jd?.title ? `Saat ini terbuka untuk peluang sebagai ${jd.title}.` : '',
  ].filter(Boolean).join(' ');
  const expLines = (cv.experience || []).slice(0, 4).flatMap((e) => [
    `${e.title || 'Peran'} — ${e.company || ''} (${e.period || ''})`.trim(),
    ...(e.bullets || []).slice(0, 3).map((a) => `• ${a}`),
    '',
  ]);
  const eduLines = (cv.education || []).slice(0, 2).map(
    (e) => `${e.degree || ''} ${e.institution || ''} ${e.year || ''}`.trim(),
  );
  return [
    `TEKS PROFIL LINKEDIN — ${name}`,
    '',
    'HEADLINE (maks 220 karakter)',
    `${headline} | ${skills.split(',').slice(0, 3).join(' · ')}`.slice(0, 220),
    '',
    'ABOUT (ringkasan)',
    about,
    '',
    'PENGALAMAN (format LinkedIn)',
    ...expLines,
    'PENDIDIKAN',
    ...eduLines,
    '',
    'KEAHLIAN UNTUK BAGIAN SKILLS',
    skills,
    '',
    'SARAN: tempel bagian di atas ke profil LinkedIn, lalu minta rekomendasi dari 2 kolega terakhir.',
    'Dokumen ini dibuat otomatis oleh LamaranKilat berdasarkan data yang Anda kirimkan.',
  ].join('\n');
}

function assertSize(file, label, minBytes = 1200) {
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_BYTES) {
    throw new Error(`${label} melebihi 1 MB (${Math.round(bytes / 1024)} KB) — gagal kirim WhatsApp`);
  }
  if (bytes < minBytes) throw new Error(`${label} terlalu kecil (${bytes} B) — render gagal`);
  return bytes;
}

async function record(input, { code, version }) {
  const bytes = assertSize(input.file, input.label, input.minBytes || 1200);
  getDb().prepare(`
    INSERT INTO documents (order_id, kind, version, path, bytes, sha256, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(input.orderId, input.kind, version, input.file, bytes, sha256File(input.file), nowIso());
  logger.info('document_rendered', { order: code, kind: input.kind, version, bytes });
  return { kind: input.kind, path: input.file, bytes, name: path.basename(input.file), title: input.title };
}

/**
 * Render semua artefak untuk satu order.
 * Deterministik untuk skor (bukan LLM); CV & surat lewat 9Router dengan validasi anti-fabrikasi.
 */
export async function generateOrderDocuments(orderId, { revisionNote = null, version = 1 } = {}) {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('order tidak ditemukan');
  const rawInput = { ...orderInput(order), phone: orderInput(order).phone };
  if (revisionNote) rawInput.revision_note = revisionNote;

  let jd = null;
  if (rawInput.jd_text && rawInput.jd_text.length >= 100) {
    const existing = db.prepare('SELECT * FROM job_descriptions WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
    if (existing?.parsed_json) {
      try { jd = JSON.parse(existing.parsed_json); } catch { jd = null; }
    }
    if (!jd) {
      jd = await parseJobDescription(rawInput.jd_text);
      db.prepare('INSERT INTO job_descriptions (order_id, raw_text, parsed_json, created_at) VALUES (?,?,?,?)')
        .run(orderId, rawInput.jd_text, JSON.stringify(jd || {}), nowIso());
    }
  }

  const { cv, usedAi, errors } = await generateCv(rawInput, jd);
  const letter = order.product === 'bundle' ? await generateLetter(rawInput, cv, jd) : null;

  const meta = { pages: 1, fonts: 1, usedAi, errors, jdMatched: Boolean(jd) };
  const score = computeAtsScore({ cv, jd, input: rawInput, meta });
  const band = atsBand(score.total);

  const dir = outputDir(order.code, version);
  const names = fileNames(cv.header?.name || rawInput.name, order.code);
  const docs = [];

  const cvPdfPath = path.join(dir, names.cvPdf);
  await renderCvPdf(cv, cvPdfPath, { template: order.template || 'ats' });
  docs.push(await record({ orderId, kind: 'cv_pdf', file: cvPdfPath, label: 'CV PDF', title: 'CV (PDF)' }, { code: order.code, version }));

  const cvDocxPath = path.join(dir, names.cvDocx);
  await renderCvDocx(cv, cvDocxPath);
  docs.push(await record({ orderId, kind: 'cv_docx', file: cvDocxPath, label: 'CV DOCX', title: 'CV (Word, bisa diedit)' }, { code: order.code, version }));

  if (letter) {
    const letterPath = path.join(dir, names.letterPdf);
    await renderLetterPdf(letter, letterPath, { name: cv.header?.name || rawInput.name, email: rawInput.email, phone: rawInput.phone, city: rawInput.city });
    docs.push(await record({ orderId, kind: 'letter_pdf', file: letterPath, label: 'Surat lamaran', title: 'Surat Lamaran (PDF)' }, { code: order.code, version }));
  }

  if (order.product === 'bundle') {
    const linkedinPath = path.join(dir, names.linkedinTxt);
    fs.writeFileSync(linkedinPath, buildLinkedinText(cv, rawInput, jd), 'utf8');
    docs.push(await record({ orderId, kind: 'linkedin_txt', file: linkedinPath, label: 'Teks LinkedIn', title: 'Teks Profil LinkedIn', minBytes: 200 }, { code: order.code, version }));
  }

  const scorePath = path.join(dir, names.scorePdf);
  await renderScorePdf({ score, order, cv, letter }, scorePath);
  docs.push(await record({ orderId, kind: 'score_pdf', file: scorePath, label: 'Laporan ATS', title: 'Laporan Skor ATS (PDF)' }, { code: order.code, version }));

  db.prepare('UPDATE orders SET ats_score = ?, ats_breakdown = ?, generated_at = ? WHERE id = ?')
    .run(score.total, JSON.stringify(score), nowIso(), orderId);

  return {
    order: { ...order, ats_score: score.total },
    cv,
    letter,
    score,
    band,
    documents: docs,
    version,
    usedAi,
  };
}

/** Ringkasan skor untuk pesan WhatsApp. */
export function scoreMessage(score, band) {
  const top = (score.suggestions || []).slice(0, 2).map((s) => `• ${truncate(s.text, 120)}`);
  return [
    `Skor ATS dokumen: ${score.total}/100 (${band.label})`,
    `Keyword ${score.keyword}/100 · Format ${score.format}/100 · Keterbacaan ${score.readability}/100 · Kontak ${score.contact}/100`,
    top.length ? 'Saran cepat:' : '',
    ...top,
  ].filter(Boolean).join('\n');
}
