import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let logFile = null;
let currentDay = null;

function fileFor(day) {
  return path.join(config.logDir, `app-${day}.log`);
}

function rotate() {
  const day = new Date().toISOString().slice(0, 10);
  if (day === currentDay) return;
  currentDay = day;
  try {
    logFile = fs.createWriteStream(fileFor(day), { flags: 'a' });
    // retensi 7 hari
    const files = fs.readdirSync(config.logDir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 7))) {
      try { fs.unlinkSync(path.join(config.logDir, f)); } catch { /* ignore */ }
    }
  } catch {
    logFile = null;
  }
}

function write(level, msg, meta) {
  rotate();
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta || {}) });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
  if (logFile) logFile.write(line + '\n');
}

export const logger = {
  debug: (msg, meta) => config.env !== 'production' && write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
