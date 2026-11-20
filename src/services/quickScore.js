import { heuristicJobDescription, normalizeInput } from './generator.js';
import { scoreKeyword, scoreContact, normalizeText } from './ats.js';

const SECTION_PATTERNS = [
  { label: 'Ringkasan/Profil', re: /(ringkasan|profil|summary|tentang saya|objective)/i },
  { label: 'Pengalaman', re: /(pengalaman|experience|riwayat pekerjaan)/i },
  { label: 'Pendidikan', re: /(pendidikan|education|riwayat pendidikan)/i },
  { label: 'Keahlian', re: /(keahlian|skills|kompetensi|kemampuan)/i },
];

/**
 * Skor cepat untuk CV teks bebas (alat publik "Cek Skor ATS").
 * Bobot sama dengan PRD Lampiran B: 40 keyword / 30 format / 20 keterbacaan / 10 kontak.
 */
export function scoreRawText(cvText, jdText = '') {
  const text = String(cvText || '').trim();
  const jdRaw = String(jdText || '').trim();
  const jd = jdRaw.length >= 60 ? heuristicJobDescription(jdRaw) : null;
  const normalized = normalizeText(text);

  // ---- keyword (40) ----
  let keyword = 55;
  let kwDetail = { matched: [], missing: [] };
  if (jd) {
    const keywords = [...(jd.keywords || []), ...(jd.soft_skills || [])].filter(Boolean).slice(0, 24);
    const matched = keywords.filter((k) => normalized.includes(String(k).toLowerCase()));
    const missing = keywords.filter((k) => !matched.includes(k)).slice(0, 10);
    keyword = keywords.length ? Math.round((matched.length / keywords.length) * 100) : 60;
    kwDetail = { matched: matched.slice(0, 12), missing };
  } else {
    // tanpa JD: nilai kepadatan istilah teknis umum
    const density = (text.match(/\b[a-zA-Z][a-zA-Z+#.]{2,}\b/g) || []).length;
    keyword = Math.min(80, Math.max(45, Math.round(35 + Math.min(45, density / 12))));
  }

  // ---- format (30) ----
  const issues = [];
  let format = 0;
  const foundSections = SECTION_PATTERNS.filter((s) => s.re.test(text));
  format += Math.round((foundSections.length / SECTION_PATTERNS.length) * 12);
  if (foundSections.length < 3) issues.push(`Bagian ${SECTION_PATTERNS.filter((s) => !foundSections.some((f) => f.label === s.label)).map((s) => s.label).join(', ')} tidak terdeteksi oleh parser ATS.`);
  const bullets = (text.match(/^\s*[•\-*]/gm) || []).length;
  format += bullets >= 4 ? 8 : bullets >= 2 ? 5 : 2;
  if (bullets < 3) issues.push('Tambahkan bullet poin pencapaian (minimal 3) agar mudah dibaca ATS.');
  const words = text.split(/\s+/).filter(Boolean).length;
  format += words >= 180 && words <= 900 ? 6 : words < 180 ? 3 : 4;
  if (words < 180) issues.push(`CV terlalu pendek (${words} kata). Target 180–600 kata.`);
  if (/\t|\|\s*\||_{4,}/.test(text)) { format -= 3; issues.push('Terdeteksi tabel/garis panjang — banyak ATS gagal membacanya.'); }
  if (/(foto|photo|nik|tanggal lahir|status pernikahan)/i.test(text)) { format -= 2; issues.push('Hapus data sensitif (foto/NIK/status) yang tidak diminta rekruter.'); }
  format = Math.max(0, Math.min(100, format));

  // ---- readability (20) ----
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.trim().length > 12);
  const avg = sentences.length ? words / sentences.length : words;
  let readability = 85;
  if (avg > 30) { readability = 60; issues.push('Kalimat terlalu panjang (rata-rata > 30 kata). Pecah jadi 1 ide per kalimat.'); }
  else if (avg > 24) { readability = 72; issues.push('Beberapa kalimat terlalu panjang. Target maksimal 22 kata.'); }
  else if (avg < 6 && words > 60) { readability = 70; issues.push('Kalimat sangat pendek/patah — gabungkan agar mengalir.'); }
  const passive = (text.match(/\b(dilakukan|dibuat|diberikan|dikerjakan|diperbaiki)\b/gi) || []).length;
  if (passive > 3) { readability = Math.max(45, readability - 12); issues.push('Banyak kalimat pasif. Gunakan kata kerja aktif (memimpin, meningkatkan, membangun).'); }
  const hasNumbers = /\b\d+([.,]\d+)?\s*(%|persen|juta|rb|ribu|orang|unit|klien|transaksi)\b/i.test(text);
  if (!hasNumbers) { readability = Math.max(50, readability - 10); issues.push('Belum ada pencapaian terukur. Tambahkan angka nyata (%, jumlah, rupiah).'); }
  const firstPerson = (text.match(/\b(saya|aku)\b/gi) || []).length;
  if (firstPerson > 4) { readability = Math.max(55, readability - 8); issues.push('Kurangi kata "saya" — CV ATS lebih kuat dengan frasa aksi.'); }

  // ---- contact (10) ----
  const input = normalizeInput({
    name: (text.split('\n')[0] || '').trim().slice(0, 60),
    email: (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0],
    phone: (text.match(/(\+62|62|0)8\d{7,12}/) || [''])[0],
    city: '',
  });
  const contactScore = scoreContact({ header: { name: input.name, email: input.email, phone: input.phone, city: '' } }, input);
  const contact = Math.round((contactScore.score ?? contactScore));
  if (!input.email) issues.push('Email tidak terdeteksi — pastikan tertulis jelas di bagian atas.');
  if (!input.phone) issues.push('Nomor HP tidak terdeteksi. Gunakan format 08xx atau +62.');

  const total = Math.round((keyword * 0.4) + (format * 0.3) + (readability * 0.2) + (contact * 0.1));
  return {
    total: Math.max(0, Math.min(100, total)),
    keyword, format, readability, contact,
    words, sections_found: foundSections.map((s) => s.label),
    matched_keywords: kwDetail.matched,
    missing_keywords: kwDetail.missing,
    issues: [...new Set(issues)].slice(0, 8),
    jd_used: Boolean(jd),
    jd_title: jd?.title || null,
  };
}

export function bandLabel(total) {
  if (total >= 85) return 'Sangat baik — siap dikirim';
  if (total >= 70) return 'Baik — sedikit perbaikan';
  if (total >= 55) return 'Cukup — perlu optimasi';
  return 'Perlu perbaikan serius';
}
