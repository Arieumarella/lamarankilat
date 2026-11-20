import { config } from '../config.js';
import { logger } from '../logger.js';

/** Alert admin via Telegram Bot API (opsional, tidak memblokir alur utama). */
export async function sendTelegram(text) {
  const { telegramToken, telegramChatId } = config.alert;
  if (!telegramToken || !telegramChatId) {
    logger.info('alert_skipped_no_telegram', { preview: String(text).slice(0, 80) });
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: String(text).slice(0, 3800), disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('telegram_alert_failed', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('telegram_alert_error', { error: String(err.message) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
