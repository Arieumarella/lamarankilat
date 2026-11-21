/**
 * Skor ATS deterministik — PRD Lampiran B.
 * total = 0.40*keyword + 0.30*format + 0.20*readability + 0.10*contact
 */

const SYNONYMS = {
  'ms excel': 'excel', 'microsoft excel': 'excel', 'microsoft office': 'office', 'ms office': 'office',
  'ms word': 'word', 'microsoft word': 'word', 'power point': 'powerpoint', 'ppt': 'powerpoint',
  'administrasi perkantoran': 'administrasi', 'admin kantor': 'administrasi',
  'customer service': 'pelayanan pelanggan', 'cs': 'pelayanan pelanggan',
  'social media': 'media sosial', 'digital marketing': 'pemasaran digital',
  'search engine optimization': 'seo', 'google analytics': 'analytics',
  'supply chain': 'rantai pasok', 'quality control': 'kontrol kualitas', 'qc': 'kontrol kualitas',
  'human resource': 'sdm', 'human resources': 'sdm', 'hr': 'sdm',
  'financial report': 'laporan keuangan', 'accounting': 'akuntansi', 'bookkeeping': 'pembukuan',
  'node js': 'nodejs', 'node.js': 'nodejs', 'js': 'javascript', 'react.js': 'react', 'vue.js': 'vue',
  'postgres': 'postgresql', 'golang': 'go', 'ci cd': 'cicd',
  'key account': 'akun kunci', 'business development': 'pengembangan bisnis',
  'project management': 'manajemen proyek', 'product management': 'manajemen produk',
  'data analysis': 'analisis data', 'data analyst': 'analis data', 'data entry': 'entri data',
  'logistics': 'logistik', 'warehouse': 'gudang', 'inventory': 'persediaan',
  'sales': 'penjualan', 'marketing': 'pemasaran', 'content creator': 'kreator konten',
  'graphic design': 'desain grafis', 'video editing': 'penyuntingan video', 'editing video': 'penyuntingan video',
  'copywriting': 'penulisan iklan', 'public speaking': 'komunikasi publik',
  'team work': 'kerja sama tim', 'teamwork': 'kerja sama tim', 'problem solving': 'pemecahan masalah',
  'time management': 'manajemen waktu', 'communication skill': 'komunikasi',
  'leadership': 'kepemimpinan', 'negotiation': 'negosiasi', 'presentation': 'presentasi',
  'cashier': 'kasir', 'barista': 'barista', 'kitchen': 'dapur', 'housekeeping': 'kebersihan',
  'guru': 'pengajar', 'teacher': 'pengajar', 'tutor': 'pengajar', 'nurse': 'perawat',
  'drafter': 'juru gambar', 'autocad': 'autocad', 'estimator': 'estimasi biaya',
  'qgis': 'sig', 'arcgis': 'sig', 'gis': 'sig',
};

const ACTION_VERBS = [
  'mengelola', 'mengembangkan', 'meningkatkan', 'memimpin', 'membangun', 'merancang', 'menganalisis',
  'menyusun', 'melaksanakan', 'mengawasi', 'menangani', 'menjual', 'melayani', 'mengurangi', 'mempercepat',
  'mengoptimalkan', 'mengimplementasikan', 'mengoordinasikan', 'melatih', 'menyelesaikan', 'memelihara',
  'membuat', 'mengatur', 'mencapai', 'memperluas', 'menguji', 'mendokumentasikan', 'mengotomatiskan',
  'mengurangi', 'memproses', 'merekapitulasi', 'memverifikasi', 'mendesain', 'memasarkan',
];

export function normalizeText(text) {
  let s = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+#.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [from, to] of Object.entries(SYNONYMS)) {
    if (!from.includes(' ') && !/[.]/.test(from)) continue; // frasa saja di level ini
    s = s.split(from).join(to);
  }
  return s;
}

function normalizeTerm(term) {
  const t = normalizeText(term);
  return SYNONYMS[t] || t;
}

/** Terima array maupun string berkoma/baris-baru dari input mentah. */
export function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean);
  return [];
}

function cvToPlainText(cv) {
  const parts = [
    cv?.header?.name, cv?.header?.headline, cv?.header?.city, cv?.summary,
    ...(cv?.skills || []),
    ...(cv?.experience || []).flatMap((e) => [e.company, e.title, e.period, ...(e.bullets || [])]),
    ...(cv?.education || []).flatMap((e) => [e.institution, e.degree, e.year]),
    ...(cv?.certifications || []),
  ];
  return parts.filter(Boolean).join(' \n ');
}

function collectKeywords(jd) {
  if (!jd) return [];
  const list = [...(jd.keywords || []), ...(jd.soft_skills || [])];
  return [...new Set(list.map((k) => String(k).trim()).filter(Boolean))];
}

export function scoreKeyword(cvText, jd, input) {
  const keywords = collectKeywords(jd);
  const haystack = normalizeText(cvText);
  if (!keywords.length) {
    // tanpa lowongan: estimasi dari keahlian + posisi target (deterministik, bukan karangan)
    const skills = asList(input?.skills);
    const roleTokens = normalizeText(input?.target_role || '').split(' ').filter((t) => t.length >= 3);
    const hitRole = roleTokens.filter((t) => haystack.includes(t)).length;
    const base = 62 + Math.min(skills.length, 10) * 2 + Math.min(hitRole, 4) * 3;
    return {
      score: Math.max(0, Math.min(92, base)),
      total: 0, matched: 0,
      note: 'Tanpa teks lowongan: keyword diperkirakan dari keahlian & posisi target.',
      matched_terms: skills.slice(0, 8), missing_terms: [],
      estimated: true,
    };
  }
  const matched = [];
  const missing = [];
  for (const kw of keywords) {
    const term = normalizeTerm(kw);
    if (!term) continue;
    if (haystack.includes(term)) matched.push(kw);
    else missing.push(kw);
  }
  const denom = Math.max(1, matched.length + missing.length);
  return {
    score: Math.round((matched.length / denom) * 100),
    total: denom, matched: matched.length,
    note: 'Intersection keyword lowongan dengan teks CV (normalisasi + sinonim).',
    matched_terms: matched.slice(0, 12),
    missing_terms: missing.slice(0, 12),
  };
}

export function scoreFormat(cv, meta = {}) {
  let score = 100;
  const penalties = [];
  const raw = (cv?.sections_present || []).map((h) => String(h).toLowerCase());
  const has = (alias) => raw.some((h) => alias.some((a) => h.includes(a)));
  const required = [
    { label: 'ringkasan', alias: ['ringkasan', 'summary', 'profil', 'tentang'] },
    { label: 'pengalaman kerja', alias: ['pengalaman', 'experience', 'pekerjaan', 'kerja'] },
    { label: 'pendidikan', alias: ['pendidikan', 'education'] },
    { label: 'keahlian', alias: ['keahlian', 'skill', 'kemampuan', 'kompetensi'] },
  ];
  const missingHeadings = required.filter((r) => !has(r.alias)).map((r) => r.label);
  if (missingHeadings.length) {
    score -= Math.min(20, missingHeadings.length * 5);
    penalties.push(`Bagian standar belum lengkap: ${missingHeadings.join(', ')} (-${Math.min(20, missingHeadings.length * 5)})`);
  }
  if ((meta.pages || 1) > 2) { score -= 10; penalties.push('Dokumen melebihi 2 halaman (-10)'); }
  if (meta.fonts && meta.fonts > 2) { score -= 10; penalties.push('Lebih dari 2 jenis font (-10)'); }
  if (meta.columns && meta.columns > 1) { score -= 25; penalties.push('Layout multi-kolom (-25)'); }
  if (meta.tables) { score -= 40; penalties.push('Menggunakan tabel/ikon/grafik (-40)'); }
  if (meta.marginCm !== undefined && meta.marginCm < 1) { score -= 10; penalties.push('Margin < 1 cm (-10)'); }
  const longBullets = (cv?.experience || []).flatMap((e) => e.bullets || []).filter((b) => b.length > 200).length;
  if (longBullets) { score -= 5; penalties.push(`${longBullets} bullet terlalu panjang (-5)`); }
  if (!(cv?.summary || '').trim()) { score -= 10; penalties.push('Ringkasan kosong (-10)'); }
  // Bonus: dokumen punya seluruh bagian wajib + ringkasan → format rapi
  if (!missingHeadings.length && (cv?.summary || '').trim() && !meta.tables && !(meta.columns > 1)) {
    score = Math.min(100, score + 4);
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    note: 'Validator rule-based: satu kolom, heading standar, tanpa tabel/ikon, maks 2 halaman.',
    penalties,
    missing_sections: missingHeadings,
  };
}

export function scoreReadabilityHeuristic(cv) {
  const bullets = (cv?.experience || []).flatMap((e) => e.bullets || []).filter(Boolean);
  if (!bullets.length) {
    return { score: 55, note: 'Belum ada bullet pengalaman yang bisa dinilai.', reasons: ['Tambahkan pencapaian dengan angka.'] };
  }
  const lengths = bullets.map((b) => b.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const idealDelta = Math.abs(avg - 110);
  let score = 100 - Math.min(28, Math.round(idealDelta / 4));
  const verbRatio = bullets.filter((b) => ACTION_VERBS.some((v) => b.toLowerCase().startsWith(v))).length / bullets.length;
  score += Math.round((verbRatio - 0.4) * 20);
  const numberRatio = bullets.filter((b) => /\d/.test(b)).length / bullets.length;
  score += Math.round((numberRatio - 0.25) * 16);
  if ((cv?.summary || '').length > 330) score -= 6;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const reasons = [];
  if (avg > 170) reasons.push('Beberapa bullet terlalu panjang; pecah menjadi dua poin.');
  if (avg < 60) reasons.push('Bullet terlalu pendek; tambahkan konteks hasil atau dampak.');
  if (verbRatio < 0.5) reasons.push('Mulai bullet dengan kata kerja aktif (mengelola, meningkatkan, ...).');
  if (numberRatio < 0.3) reasons.push('Sertakan angka terukur pada pencapaian bila tersedia.');
  return {
    score,
    note: 'Heuristik keterbacaan (panjang bullet, kata kerja aktif, angka terukur).',
    reasons: reasons.slice(0, 3),
  };
}

export function scoreContact(cv, input) {
  const fields = {
    nama: cv?.header?.name || input?.name,
    telepon: cv?.header?.phone || input?.phone,
    email: cv?.header?.email || input?.email,
    kota: cv?.header?.city || input?.city,
  };
  const missing = Object.entries(fields).filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
  return {
    score: Math.max(0, 100 - missing.length * 25),
    note: missing.length ? `Kontak belum lengkap: ${missing.join(', ')}` : 'Nama, telepon, email, dan kota tersedia.',
    missing,
  };
}

/**
 * @param {object} params
 * @param {object} params.cv  output CV terstruktur
 * @param {object|null} params.jd parsed job description
 * @param {object} params.input data mentah user
 * @param {object|null} params.readability {score, reasons} dari LLM (opsional)
 * @param {object} params.meta {pages, fonts, columns, tables, marginCm}
 */
export function computeAtsScore({ cv, jd, input, readability = null, meta = {} }) {
  const cvText = cvToPlainText(cv);
  const keyword = scoreKeyword(cvText, jd, input);
  const format = scoreFormat(cv, { pages: meta.pages || 1, fonts: meta.fonts || 1, columns: 1, tables: false, marginCm: meta.marginCm ?? 1.8 });
  const readable = readability && Number.isFinite(readability.score)
    ? { score: Math.max(0, Math.min(100, Math.round(readability.score))), note: 'Penilaian keterbacaan oleh model (temperature 0).', reasons: readability.reasons || [] }
    : scoreReadabilityHeuristic(cv);
  const contact = scoreContact(cv, input);

  const total = Math.round(0.4 * keyword.score + 0.3 * format.score + 0.2 * readable.score + 0.1 * contact.score);

  const suggestions = [];
  const ranked = [
    { key: 'keyword', score: keyword.score, weight: 0.4, label: 'Keyword' },
    { key: 'format', score: format.score, weight: 0.3, label: 'Format' },
    { key: 'readability', score: readable.score, weight: 0.2, label: 'Keterbacaan' },
    { key: 'contact', score: contact.score, weight: 0.1, label: 'Kontak' },
  ].sort((a, b) => a.score * a.weight - b.score * b.weight);

  for (const item of ranked) {
    if (suggestions.length >= 3) break;
    if (item.key === 'keyword') {
      const missing = (keyword.missing_terms || []).slice(0, 3);
      if (missing.length) {
        suggestions.push({
          component: 'keyword',
          text: `Tambahkan keahlian yang relevan dengan lowongan: ${missing.join(', ')}.`,
          reason: `Keyword match ${keyword.score}/100 — kata kunci ini belum muncul di CV.`,
        });
      } else if (keyword.score < 90) {
        suggestions.push({
          component: 'keyword',
          text: 'Sisipkan istilah teknis dari lowongan pada bullet pencapaian, bukan hanya di daftar keahlian.',
          reason: `Keyword match baru ${keyword.score}/100.`,
        });
      }
    } else if (item.key === 'format') {
      suggestions.push({
        component: 'format',
        text: 'Pertahankan satu kolom, heading standar, dan tanpa tabel/ikon agar parser ATS tidak tersandung.',
        reason: format.penalties?.[0] || `Format ${format.score}/100.`,
      });
    } else if (item.key === 'readability') {
      suggestions.push({
        component: 'readability',
        text: (readable.reasons && readable.reasons[0]) || 'Tulis bullet dengan pola "kata kerja aktif + tindakan + hasil terukur".',
        reason: `Keterbacaan ${readable.score}/100.`,
      });
    } else if (item.key === 'contact' && (contact.missing || []).length) {
      suggestions.push({
        component: 'contact',
        text: `Lengkapi data kontak berikut: ${(contact.missing || []).join(', ')}.`,
        reason: `Kelengkapan kontak ${contact.score}/100.`,
      });
    }
  }

  return {
    total,
    components: {
      keyword: { ...keyword, weight: 0.4, label: 'Kecocokan keyword' },
      format: { ...format, weight: 0.3, label: 'Format & parseability' },
      readability: { ...readable, weight: 0.2, label: 'Kejelasan & keterbacaan' },
      contact: { ...contact, weight: 0.1, label: 'Kelengkapan kontak' },
    },
    suggestions: suggestions.slice(0, 3),
    computed_at: new Date().toISOString(),
  };
}

export function atsBand(total) {
  if (total >= 85) return { label: 'Sangat baik', tone: 'good' };
  if (total >= 70) return { label: 'Baik', tone: 'ok' };
  if (total >= 55) return { label: 'Cukup', tone: 'warn' };
  return { label: 'Perlu perbaikan', tone: 'bad' };
}
