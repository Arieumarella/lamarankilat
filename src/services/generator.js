import { chatJson, router9Available } from './ai/router9.js';
import { logger } from '../logger.js';
import { capitalizeSentence, truncate } from '../util.js';

const SKILL_DICTIONARY = [
  'excel', 'word', 'powerpoint', 'google sheets', 'sql', 'python', 'javascript', 'php', 'java', 'golang',
  'nodejs', 'react', 'vue', 'laravel', 'mysql', 'postgresql', 'mongodb', 'docker', 'git', 'linux',
  'figma', 'canva', 'photoshop', 'illustrator', 'premiere pro', 'capcut', 'autocad', 'sketchup',
  'digital marketing', 'seo', 'sem', 'google ads', 'facebook ads', 'tiktok ads', 'copywriting',
  'content creation', 'social media', 'marketplace', 'shopee', 'tokopedia', 'sales', 'negotiation',
  'customer service', 'communication', 'leadership', 'teamwork', 'problem solving', 'time management',
  'accounting', 'bookkeeping', 'tax', 'audit', 'financial reporting', 'budgeting', 'payroll',
  'recruitment', 'training', 'administration', 'data entry', 'data analysis', 'reporting',
  'logistics', 'warehouse', 'inventory', 'supply chain', 'quality control', 'production planning',
  'teaching', 'curriculum', 'classroom management', 'nursing', 'patient care', 'pharmacy',
  'barista', 'food and beverage', 'kitchen', 'hospitality', 'housekeeping', 'cashier',
  'project management', 'agile', 'scrum', 'business development', 'product management', 'crm',
  'hardware', 'networking', 'technical support', 'troubleshooting', 'cybersecurity',
  'english', 'mandarin', 'japanese', 'korean', 'public speaking', 'presentation', 'writing',
];

const SOFT_SKILLS = ['komunikasi', 'kerja sama tim', 'kepemimpinan', 'manajemen waktu', 'inisiatif',
  'adaptif', 'teliti', 'problem solving', 'negosiasi', 'kreatif', 'disiplin', 'cepat belajar'];

const ACTION_STARTERS = ['Mengelola', 'Mengembangkan', 'Meningkatkan', 'Memimpin', 'Membangun',
  'Merancang', 'Menganalisis', 'Menyusun', 'Melaksanakan', 'Mengawasi', 'Menangani', 'Mengoptimalkan',
  'Mengimplementasikan', 'Mengoordinasikan', 'Melatih', 'Menyelesaikan', 'Memelihara', 'Membuat',
  'Mengatur', 'Mencapai', 'Menguji', 'Memproses', 'Merekapitulasi', 'Memverifikasi', 'Mendesain'];

export function splitList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw || '')
    .split(/[,;\n•|]+/)
    .map((s) => s.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean);
}

function normalizePeriod(text) {
  const m = String(text || '').match(/(19|20)\d{2}\s*(?:[-–—/]|sampai|hingga|s\.d\.?)?\s*(?:(19|20)\d{2}|sekarang|now|present)?/i);
  if (!m) return String(text || '').trim();
  const start = m[0].match(/(19|20)\d{2}/)?.[0];
  const years = m[0].match(/(19|20)\d{2}/g) || [];
  const end = years.length > 1 ? years[1] : (/sekarang|now|present/i.test(m[0]) ? 'Sekarang' : '');
  return end ? `${start}–${end}` : String(start);
}

/** Pecah pengalaman teks bebas menjadi struktur. */
export function parseExperienceRaw(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks = lines.length > 1 ? lines : text.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
  return blocks.map((line) => {
    const [head, ...rest] = line.split(/\s*[,|]\s*/);
    const period = normalizePeriod(line);
    const company = head?.trim() || '';
    const restText = rest.join(', ');
    const title = rest[0]?.replace(/(19|20)\d{2}.*$/, '').trim() || '';
    const achievementsRaw = restText
      .replace(/(19|20)\d{2}\s*[-–—/]?\s*((19|20)\d{2}|sekarang|now|present)?/gi, '')
      .split(/[.;•]\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 12);
    return {
      company,
      title,
      period,
      achievements: achievementsRaw.slice(0, 6),
      raw: line,
    };
  }).filter((e) => e.company);
}

export function parseEducationsRaw(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const lines = text.split(/\n+|;\s*/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/\s*[,|]\s*/);
    const institution = parts[0] || '';
    const year = (line.match(/(19|20)\d{2}(\s*[-–]\s*(19|20)\d{2})?/) || [''])[0];
    const degree = parts.slice(1).join(', ').replace(/(19|20)\d{2}.*$/, '').trim();
    const gpaMatch = line.match(/(ipk|gpa)\s*[:=]?\s*([0-9]+([.,][0-9]+)?)/i);
    return {
      institution,
      degree,
      year,
      gpa: gpaMatch ? gpaMatch[2].replace(',', '.') : '',
    };
  }).filter((e) => e.institution);
}

/** Lengkapi struktur input dari teks bebas. */
export function normalizeInput(raw = {}) {
  const experiences = Array.isArray(raw.experiences) && raw.experiences.length
    ? raw.experiences.map((e) => ({
      company: String(e.company || '').trim(),
      title: String(e.title || '').trim(),
      period: String(e.period || '').trim(),
      achievements: splitList(e.achievements),
    }))
    : parseExperienceRaw(raw.experience_raw).map((e) => ({
      company: e.company, title: e.title, period: e.period,
      achievements: e.achievements,
    }));
  const educations = Array.isArray(raw.educations) && raw.educations.length
    ? raw.educations.map((e) => ({
      institution: String(e.institution || '').trim(),
      degree: String(e.degree || '').trim(),
      year: String(e.year || '').trim(),
      gpa: String(e.gpa || '').trim(),
    }))
    : parseEducationsRaw(raw.education_raw);
  return {
    ...raw,
    name: String(raw.name || '').trim(),
    email: String(raw.email || '').trim(),
    city: String(raw.city || '').trim(),
    phone: String(raw.phone || '').trim(),
    target_role: String(raw.target_role || '').trim(),
    target_company: String(raw.target_company || '').trim(),
    experience_raw: String(raw.experience_raw || '').trim(),
    education_raw: String(raw.education_raw || '').trim(),
    experiences,
    educations,
    skills: splitList(raw.skills).slice(0, 12),
    certifications: splitList(raw.certifications).slice(0, 8),
    links: splitList(raw.links).slice(0, 3),
    salary_expectation: String(raw.salary_expectation || '').trim(),
    jd_text: String(raw.jd_text || '').trim(),
  };
}

function polishBullet(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  s = s.replace(/^(saya|aku)\s+/i, '');
  if (!s) return '';
  const first = s.split(' ')[0]?.toLowerCase();
  if (!ACTION_STARTERS.some((v) => v.toLowerCase() === first)) {
    const verb = /(\d+%|\d+\s*(unit|orang|klien|transaksi|juta|rb|ribu))/.test(s) ? 'Mencapai' : 'Menangani';
    s = `${verb} ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  } else {
    s = capitalizeSentence(s);
  }
  return truncate(s, 190);
}

/** Template deterministik: tanpa LLM, tanpa fabrikasi. */
export function buildFallbackCv(input) {
  const data = normalizeInput(input);
  const headline = data.target_role || (data.experiences[0]?.title ?? 'Pencari Kerja');
  const summaryBits = [];
  if (data.experiences.length && data.experiences[0].title) {
    summaryBits.push(`Profesional dengan pengalaman sebagai ${data.experiences[0].title}${data.experiences[0].company ? ` di ${data.experiences[0].company}` : ''}.`);
  } else {
    summaryBits.push(`Lulusan ${data.educations[0]?.degree || data.educations[0]?.institution || 'pendidikan terakhir'} yang siap berkontribusi.`);
  }
  if (data.skills.length) summaryBits.push(`Menguasai ${data.skills.slice(0, 5).join(', ')}.`);
  summaryBits.push(`Sedang melamar posisi ${headline}${data.target_company ? ` di ${data.target_company}` : ''} dan siap bekerja dengan target terukur.`);

  const experience = data.experiences.map((e) => ({
    company: e.company,
    title: e.title || headline,
    period: e.period || '',
    bullets: (e.achievements.length ? e.achievements : [e.raw || `Menjalankan tugas sebagai ${e.title || headline} di ${e.company}.`])
      .map(polishBullet).filter(Boolean).slice(0, 6),
  }));

  const education = data.educations.map((e) => ({
    institution: e.institution,
    degree: [e.degree, e.gpa ? `IPK ${e.gpa}` : ''].filter(Boolean).join(' — '),
    year: e.year,
  }));

  return {
    header: {
      name: data.name,
      headline,
      city: data.city,
      email: data.email,
      phone: data.phone,
      links: data.links,
    },
    summary: truncate(summaryBits.join(' '), 380),
    skills: data.skills,
    experience,
    education,
    certifications: data.certifications,
    source: 'fallback',
    sections_present: ['Ringkasan', 'Pengalaman Kerja', 'Pendidikan', 'Keahlian'],
  };
}

/** Validator anti-fabrikasi — kode, bukan LLM. */
export function validateCv(cv, rawInput) {
  const input = normalizeInput(rawInput);
  const errors = [];
  if (!cv || typeof cv !== 'object') return { ok: false, errors: ['CV bukan objek'] };

  const inputText = [
    rawInput.experience_raw, rawInput.education_raw, input.name, input.email, input.city,
    input.target_role, input.target_company, ...input.skills, ...input.certifications,
    ...input.experiences.flatMap((e) => [e.company, e.title, ...e.achievements]),
    ...input.educations.flatMap((e) => [e.institution, e.degree, e.year]),
    JSON.stringify(rawInput),
  ].filter(Boolean).join(' ').toLowerCase();

  const fuzzyHas = (needle) => {
    const n = String(needle || '').toLowerCase().trim();
    if (!n) return true;
    if (inputText.includes(n)) return true;
    const words = n.split(/\s+/).filter((w) => w.length >= 4);
    if (!words.length) return true;
    const hits = words.filter((w) => inputText.includes(w)).length;
    return hits / words.length >= 0.85;
  };

  for (const [i, e] of (cv.experience || []).entries()) {
    if (!fuzzyHas(e.company)) errors.push(`experience[${i}].company tidak ada di input: "${e.company}"`);
    if (e.title && !fuzzyHas(e.title)) errors.push(`experience[${i}].title tidak ada di input: "${e.title}"`);
  }
  for (const [i, e] of (cv.education || []).entries()) {
    if (!fuzzyHas(e.institution)) errors.push(`education[${i}].institution tidak ada di input: "${e.institution}"`);
  }
  for (const c of cv.certifications || []) {
    if (!fuzzyHas(c)) errors.push(`certification tidak ada di input: "${c}"`);
  }
  const allowedSkills = new Set(input.skills.map((s) => s.toLowerCase()));
  for (const s of cv.skills || []) {
    if (!allowedSkills.has(String(s).toLowerCase()) && !fuzzyHas(s)) errors.push(`skill tidak dikonfirmasi user: "${s}"`);
  }

  const inputNumbers = new Set((inputText.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')));
  const cvNumbers = (JSON.stringify(cv).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'));
  const foreign = [...new Set(cvNumbers)].filter((n) => !inputNumbers.has(n) && n.length > 1);
  if (foreign.length) errors.push(`angka tidak ada di input: ${foreign.slice(0, 5).join(', ')}`);

  if (typeof cv.summary === 'string' && cv.summary.length > 400) errors.push('summary >400 karakter');
  for (const e of cv.experience || []) {
    if ((e.bullets || []).length > 6) errors.push(`bullet >6 pada ${e.company}`);
    for (const b of e.bullets || []) if (b.length > 200) errors.push(`bullet >200 karakter pada ${e.company}`);
  }
  if ((cv.skills || []).length > 12) errors.push('skills >12');
  const blob = JSON.stringify(cv);
  if (/\{\{|\[[A-Z ]{3,}\]|undefined|null/.test(blob)) errors.push('placeholder/undefined terdeteksi');
  if (!cv.header?.name) errors.push('header.name kosong');

  return { ok: errors.length === 0, errors: errors.slice(0, 12) };
}

export async function parseJobDescription(rawText) {
  const text = String(rawText || '').trim();
  if (text.length < 100) return null;
  const ai = await chatJson({ templateKey: 'jd_parse_v1', prompt: text, temperature: 0, maxTokens: 500 });
  if (ai && Array.isArray(ai.keywords)) {
    return {
      title: ai.title || guessTitle(text),
      company: ai.company || '',
      seniority: ai.seniority || guessSeniority(text),
      keywords: ai.keywords.slice(0, 20).map(String),
      soft_skills: (ai.soft_skills || []).slice(0, 10).map(String),
      requirements: (ai.requirements || []).slice(0, 8).map(String),
      source: 'ai',
    };
  }
  return heuristicJobDescription(text);
}

export function guessTitle(text) {
  const first = text.split(/\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  return truncate(first.replace(/^(lowongan|job|posisi|hiring)\s*[:\-]?\s*/i, ''), 90);
}

export function guessSeniority(text) {
  const t = text.toLowerCase();
  if (/senior|lead|head|manager|5\+ tahun|minimal 5/.test(t)) return 'senior';
  if (/junior|fresh graduate|entry level|magang|intern/.test(t)) return 'junior';
  return 'mid';
}

export function heuristicJobDescription(text) {
  const lower = text.toLowerCase();
  const found = SKILL_DICTIONARY.filter((s) => lower.includes(s));
  const soft = SOFT_SKILLS.filter((s) => lower.includes(s));
  const requirements = text
    .split(/\n/)
    .map((l) => l.replace(/^[\s\-•*\d.)]+/, '').trim())
    .filter((l) => l.length > 18 && l.length < 160)
    .slice(0, 8);
  return {
    title: guessTitle(text),
    company: '',
    seniority: guessSeniority(text),
    keywords: [...new Set(found.map(titleCaseSkill))].slice(0, 20),
    soft_skills: [...new Set(soft.map(titleCaseSkill))].slice(0, 10),
    requirements,
    source: 'heuristic',
  };
}

function titleCaseSkill(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function readabilityFromAi(cv) {
  if (!router9Available()) return null;
  const ai = await chatJson({
    templateKey: 'readability_v1',
    prompt: JSON.stringify({ summary: cv.summary, experience: cv.experience }),
    temperature: 0,
    maxTokens: 300,
    model: undefined,
  });
  if (ai && Number.isFinite(Number(ai.score))) {
    return { score: Number(ai.score), reasons: (ai.reasons || []).slice(0, 3).map(String) };
  }
  return null;
}

/** Generate CV via AI (validasi ketat) dengan fallback deterministik. */
export async function generateCv(rawInput, jd = null) {
  const input = normalizeInput(rawInput);
  const payload = {
    ...input,
    jd_keywords: jd ? [...(jd.keywords || []), ...(jd.soft_skills || [])] : [],
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ai = await chatJson({
      templateKey: 'cv_v1',
      prompt: JSON.stringify(payload),
      temperature: attempt === 0 ? 0.2 : 0,
      maxTokens: 1500,
    });
    if (!ai) break;
    const candidate = {
      header: {
        name: ai.header?.name || input.name,
        headline: ai.header?.headline || input.target_role,
        city: ai.header?.city || input.city,
        email: ai.header?.email || input.email,
        phone: ai.header?.phone || input.phone,
        links: Array.isArray(ai.header?.links) ? ai.header.links.slice(0, 3) : input.links,
      },
      summary: String(ai.summary || '').slice(0, 400),
      skills: (ai.skills || []).map(String).slice(0, 12),
      experience: (ai.experience || []).map((e) => ({
        company: String(e.company || ''),
        title: String(e.title || ''),
        period: String(e.period || ''),
        bullets: (e.bullets || []).map((b) => truncate(String(b), 200)).slice(0, 6),
      })),
      education: (ai.education || []).map((e) => ({
        institution: String(e.institution || ''),
        degree: String(e.degree || ''),
        year: String(e.year || ''),
      })),
      certifications: (ai.certifications || []).map(String),
      source: 'ai',
    };
    candidate.sections_present = ['Ringkasan', 'Pengalaman Kerja', 'Pendidikan', 'Keahlian'];
    const check = validateCv(candidate, rawInput);
    if (check.ok) return { cv: candidate, usedAi: true, errors: [] };
    logger.warn('cv_validation_failed', { attempt, errors: check.errors.slice(0, 4) });
    if (attempt === 1) return { cv: buildFallbackCv(rawInput), usedAi: false, errors: check.errors };
  }
  return { cv: buildFallbackCv(rawInput), usedAi: false, errors: [] };
}

export function buildFallbackLetter(rawInput, cv, jd) {
  const input = normalizeInput(rawInput);
  const role = input.target_role || cv?.header?.headline || 'posisi yang dilamar';
  const company = input.target_company || jd?.company || '';
  const strengths = [];
  for (const e of (cv?.experience || []).slice(0, 1)) {
    if (e.title) strengths.push(`pengalaman sebagai ${e.title} di ${e.company}`);
    const bullet = (e.bullets || [])[0];
    if (bullet) strengths.push(bullet.replace(/\.$/, '').toLowerCase());
  }
  if (input.skills.length) strengths.push(`keahlian ${input.skills.slice(0, 3).join(', ')}`);
  const three = strengths.slice(0, 3);
  const today = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' }).format(new Date());

  const body = [
    `${input.city || 'Indonesia'}, ${today}`,
    '',
    `Kepada Yth. Tim Rekrutmen${company ? ` ${company}` : ''}`,
    '',
    `Dengan hormat,`,
    `Saya ${input.name || ''} dengan ini mengajukan lamaran untuk posisi ${role}${company ? ` di ${company}` : ''}. Saya tertarik berkontribusi karena posisi ini sejalan dengan pengalaman dan keahlian yang saya miliki.`,
    three.length
      ? `Sebagai bahan pertimbangan, saya membawa ${three.join('; ')}. Saya terbiasa bekerja dengan target, menjaga ketelitian administrasi, dan berkoordinasi lintas tim untuk menyelesaikan pekerjaan tepat waktu.`
      : `Saya terbiasa bekerja dengan target, menjaga ketelitian, dan berkoordinasi lintas tim untuk menyelesaikan pekerjaan tepat waktu.`,
    `Saya siap mengikuti proses seleksi dan dapat menjelaskan kontribusi saya secara lebih rinci pada wawancara. Terima kasih atas waktu dan pertimbangannya.`,
    '',
    'Hormat saya,',
    input.name || '',
  ].join('\n');

  return {
    subject: `Lamaran Pekerjaan — ${role}`,
    body,
    closing: input.name || '',
  };
}

export async function generateLetter(rawInput, cv, jd = null) {
  const input = normalizeInput(rawInput);
  const payload = {
    name: input.name, city: input.city, target_role: input.target_role,
    target_company: input.target_company || jd?.company || '',
    skills: input.skills, summary: cv.summary,
    experience: (cv.experience || []).map((e) => ({ company: e.company, title: e.title, bullets: (e.bullets || []).slice(0, 2) })),
    education: cv.education,
  };
  const ai = await chatJson({ templateKey: 'letter_v1', prompt: JSON.stringify(payload), temperature: 0.3, maxTokens: 900 });
  if (ai && typeof ai.body === 'string' && ai.body.length > 250) {
    const body = ai.body.replace(/\{\{[^}]+\}\}|\[[A-Z ]{3,}\]/g, '').trim();
    const words = body.split(/\s+/).length;
    if (words <= 380) {
      return { subject: String(ai.subject || `Lamaran Pekerjaan — ${input.target_role}`), body, closing: String(ai.closing || input.name), source: 'ai' };
    }
  }
  return { ...buildFallbackLetter(rawInput, cv, jd), source: 'fallback' };
}
