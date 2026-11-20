/**
 * Test inti (tanpa server HTTP): skema, order lifecycle, pembayaran, skor ATS.
 * Jalankan: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ARTEFACT_DIR = path.join(tmp, 'artefacts');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.LOG_DIR = path.join(tmp, 'logs');
process.env.ADMIN_PASS = 'test-password-123';
process.env.PAYMENT_MODE = 'manual_confirm';
process.env.ROUTER9_API_KEY = '';

const { migrate, hashPassword, verifyPassword } = await import('../src/migrate.js');
const { getDb } = await import('../src/db.js');
const { getOrCreateCustomer } = await import('../src/services/customers.js');
const orders = await import('../src/services/orders.js');
const payments = await import('../src/services/payments.js');
const { computeAtsScore, atsBand } = await import('../src/services/ats.js');
const { scoreRawText } = await import('../src/services/quickScore.js');
const { normalizePhone, isValidPhone, formatRupiah, escapeHtml } = await import('../src/util.js');

migrate();

test('migrasi membuat tabel utama', () => {
  const names = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['customers', 'orders', 'payments', 'documents', 'jobs', 'wa_messages', 'admins', 'audit_log']) {
    assert.ok(names.includes(t), `tabel ${t} harus ada`);
  }
});

test('hash password scrypt bisa diverifikasi', () => {
  const stored = hashPassword('rahasia-sekali');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('rahasia-sekali', stored), true);
  assert.equal(verifyPassword('salah', stored), false);
});

test('normalisasi nomor WhatsApp Indonesia', () => {
  assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizePhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizePhone('6281234567890'), '6281234567890');
  assert.equal(isValidPhone('6281234567890'), true);
  assert.equal(isValidPhone('12345'), false);
});

test('escapeHtml menutup tag berbahaya', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('format rupiah memakai pemisah ribuan', () => {
  assert.match(formatRupiah(35000), /35\.000/);
});

test('order lifecycle: draft → awaiting_payment → paid → generating → delivered', () => {
  const customer = getOrCreateCustomer('6281234500001', 'Test User');
  const order = orders.createOrder({
    customerId: customer.id,
    product: 'bundle',
    input: { name: 'Test User', target_role: 'Staff Admin', skills: 'excel, komunikasi' },
  });
  assert.equal(order.status, 'draft');
  assert.equal(order.price, 35000);

  orders.transition(order.id, 'awaiting_payment');
  const payment = payments.createPaymentForOrder(orders.getOrder(order.id));
  assert.ok(payment.amount >= 35000 && payment.amount <= 35999, 'nominal unik harus dalam rentang');
  assert.match(payment.amount.toString(), /^(3500[0-9]|350[1-9][0-9]|35[1-9][0-9]{2})$/);

  payments.approvePayment(payment.id, 'test');
  orders.transition(order.id, 'paid');
  orders.transition(order.id, 'generating');
  orders.transition(order.id, 'delivered');
  const final = orders.getOrder(order.id);
  assert.equal(final.status, 'delivered');
  assert.ok(final.paid_at, 'paid_at harus terisi');
});

test('transisi terlarang ditolak', () => {
  const customer = getOrCreateCustomer('6281234500002', 'Guard Test');
  const order = orders.createOrder({ customerId: customer.id, product: 'cv', input: {} });
  assert.throws(() => orders.transition(order.id, 'delivered'), /transisi/i);
});

test('nominal unik tidak bentrok untuk order berbeda', () => {
  const c1 = getOrCreateCustomer('6281234500003', 'A');
  const c2 = getOrCreateCustomer('6281234500004', 'B');
  const o1 = orders.createOrder({ customerId: c1.id, product: 'cv', input: {} });
  const o2 = orders.createOrder({ customerId: c2.id, product: 'cv', input: {} });
  const p1 = payments.createPaymentForOrder(o1);
  const p2 = payments.createPaymentForOrder(o2);
  assert.notEqual(p1.amount, p2.amount);
});

test('skor ATS deterministik dan dalam rentang 0-100', () => {
  const cv = `Budi Santoso
budi@example.com | 081234567890 | Jakarta

RINGKASAN
Digital marketing specialist dengan 5 tahun pengalaman.

PENGALAMAN
Digital Marketing Executive, PT Maju Jaya, 2021-2024
- Meningkatkan ROAS 2.1x menjadi 4.3x
- Mengelola budget iklan Rp450 juta

PENDIDIKAN
S1 Ilmu Komunikasi, Universitas Indonesia, 2019

KEAHLIAN
SEO, Google Ads, Meta Ads, copywriting, Google Analytics`;
  const jd = `Kami mencari Digital Marketing Specialist. Kualifikasi: pengalaman SEO, Google Ads, Meta Ads, copywriting, Google Analytics, minimal 3 tahun. Tanggung jawab: mengelola budget iklan, analisis performa.`;
  const a = computeAtsScore({ cv, jd });
  const b = computeAtsScore({ cv, jd });
  assert.equal(a.total, b.total);
  assert.ok(a.total >= 0 && a.total <= 100);
  assert.ok(a.total > 40, `skor CV relevan harusnya > 40, dapat ${a.total}`);
  assert.equal(atsBand(a.total).label, a.total >= 85 ? 'Sangat baik' : a.total >= 70 ? 'Baik' : a.total >= 55 ? 'Cukup' : 'Perlu perbaikan');
});

test('quickScore konsisten untuk teks mentah', () => {
  const r = scoreRawText('Pengalaman kerja di bidang pemasaran digital. Pendidikan S1. Keahlian SEO dan Google Ads. Kontak: a@b.com 0812', 'Butuh SEO dan Google Ads');
  assert.ok(r.total >= 0 && r.total <= 100);
  assert.ok(Array.isArray(r.missing_keywords));
  assert.equal(typeof r.total, 'number');
});
