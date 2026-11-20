// Mendaftarkan seluruh handler job sekali saja (side-effect import).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function registerAll() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js');
  for (const file of files.sort()) {
    await import(path.join(dir, file));
    logger.info('job_module_loaded', { file });
  }
}
