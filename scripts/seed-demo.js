/**
 * Seed data demo: 3 order lengkap dengan dokumen nyata (tanpa WhatsApp).
 * Jalankan: node scripts/seed-demo.js --yes
 * Jangan dijalankan pada database produksi berisi data pelanggan asli.
 */
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import { getDb, audit } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { registerAll } from '../src/jobs/index.js';
import { getOrCreateCustomer } from '../src/services/customers.js';
import { createOrder, transition, getOrder } from '../src/services/orders.js';
import { createPaymentForOrder } from '../src/services/payments.js';
import { startFulfillment } from '../src/services/fulfillment.js';
import { drain, queueStats } from '../src/services/jobs.js';
import { ensureDir } from '../src/util.js';

if (!process.argv.includes('--yes')) {
  console.error('Tambahkan --yes untuk benar-benar menulis data demo.');
  process.exit(1);
}

ensureDir(config.dbDir);
migrate();
await registerAll();

const samples = [
  {
    phone: '628111000001',
    name: 'Rina Kartika',
    email: 'rina.kartika@example.com',
    role: 'Digital Marketing Specialist',
    company: 'Tokopedia',
    skills: 'SEO, Google Ads, Meta Ads, copywriting, Google Analytics, content strategy',
    education: 'S1 Ilmu Komunikasi, Universitas Padjadjaran, 2019, IPK 3.62',
    experience: 'Digital Marketing Executive di PT Sinar Digital (2021-2024): mengelola budget iklan Rp450 juta/tahun, menaikkan ROAS 2.1x menjadi 4.3x. Marketing Intern di Agensi Kreatif (2020): menyusun kalender konten 12 bulan.',
    product: 'bundle',
  },
  {
    phone: '628111000002',
    name: 'Bagus Pratama',
    email: 'bagus.pratama@example.com',
    role: 'Staff Akuntansi',
    company: 'PT Sumber Makmur',
    skills: 'Akuntansi, Excel, SAP, rekonsiliasi bank, laporan keuangan, pajak PPH 21',
    education: 'S1 Akuntansi, Universitas Brawijaya, 2020, IPK 3.45',
    experience: 'Staff Accounting di PT Mitra Niaga (2021-2024): menyusun laporan bulanan, rekonsiliasi 4 rekening bank, memproses payroll 120 karyawan. Intern Audit di KAP (2020).',
    product: 'cv',
  },
  {
    phone: '628111000003',
    name: 'Siti Nurhaliza',
    email: 'siti.nurhaliza@example.com',
    role: 'Customer Service Supervisor',
    company: 'Shopee',
    skills: 'customer service, complaint handling, team lead, SLA, CRM, Zendesk, training',
    education: 'S1 Manajemen, Universitas Indonesia, 2018, IPK 3.71',
    experience: 'CS Supervisor di PT Layanan Prima (2020-2024): memimpin 18 agen, menurunkan first response time dari 9 menit ke 3 menit, CSAT 92%. CS Agent (2018-2020).',
    product: 'bundle',
  },
];

const created = [];
for (const s of samples) {
  const customer = getOrCreateCustomer(s.phone, s.name);
  const order = createOrder({
    customerId: customer.id,
    product: s.product,
    source: 'seed',
    input: {
      name: s.name,
      email: s.email,
      phone: s.phone,
      target_role: s.role,
      target_company: s.company,
      skills: s.skills,
      education: s.education,
      experience: s.experience,
      achievements: '',
      job_description: '',
      tone: 'profesional',
      language: 'id',
    },
  });
  const payment = createPaymentForOrder(order);
  await startFulfillment(order.id, { actor: 'seed', paymentId: payment.id });
  created.push({ code: order.code, phone: s.phone, id: order.id });
}

await drain(6);
const stats = queueStats();
const final = created.map((c) => {
  const o = getOrder(c.id);
  return { code: o.code, status: o.status, ats: o.ats_score, docs: getDb().prepare('SELECT COUNT(*) c FROM documents WHERE order_id = ?').get(o.id).c };
});

audit('seed', 'demo_seeded', 'system', null, { count: created.length });
console.log(JSON.stringify({ created: final, queue: stats }, null, 2));
logger.info('seed_demo_done', { count: created.length });
process.exit(0);
