import { tickOnce, queueStats } from '../services/jobs.js';
import { expireStaleOrders, cleanupExpiredArtefacts } from '../services/retention.js';
import { logger } from '../logger.js';

let timer = null;
let running = false;
let lastMaintenance = 0;

export async function runWorkerTick() {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const worked = await tickOnce();
      if (!worked) break;
    }
    const now = Date.now();
    if (now - lastMaintenance > 6 * 3600 * 1000) {
      lastMaintenance = now;
      expireStaleOrders();
      cleanupExpiredArtefacts();
    }
  } catch (err) {
    logger.error('worker_tick_error', { error: String(err.message) });
  } finally {
    running = false;
  }
}

export function startWorker() {
  if (timer) return;
  timer = setInterval(runWorkerTick, 1500);
  if (timer.unref) timer.unref();
  lastMaintenance = 0;
  logger.info('worker_started', { intervalMs: 1500, queue: queueStats() });
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
