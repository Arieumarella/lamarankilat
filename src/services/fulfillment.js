import { getDb } from '../db.js';
import { transition, getOrder } from './orders.js';
import { approvePayment } from './payments.js';
import { enqueue } from './jobs.js';
import { notifyPaid } from './conversation.js';
import { audit } from '../db.js';

/**
 * Alur setelah pembayaran terverifikasi admin:
 * awaiting_payment → paid → generating, kirim notifikasi, enqueue render.
 */
export async function startFulfillment(orderId, { actor = 'admin', paymentId = null } = {}) {
  let order = getOrder(orderId);
  if (!order) throw new Error('order tidak ditemukan');
  if (paymentId) approvePayment(paymentId, actor);
  if (order.status === 'awaiting_payment') {
    order = transition(order.id, 'paid', { actor }, actor);
  }
  if (order.status === 'paid') {
    order = transition(order.id, 'generating', { actor }, actor);
  }
  if (!['generating', 'needs_human'].includes(order.status)) {
    throw new Error(`order berstatus ${order.status}, tidak bisa digenerate`);
  }
  if (order.status === 'needs_human') order = transition(order.id, 'generating', { actor }, actor);
  await notifyPaid(order.id);
  enqueue('generate_documents', { order_id: order.id, version: (order.revision_count || 0) + 1 });
  audit(actor, 'fulfillment_started', 'order', order.id);
  return order;
}
