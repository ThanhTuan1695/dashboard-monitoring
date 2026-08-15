const axios = require('axios');

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_ON_RECOVERY = process.env.ALERT_ON_RECOVERY !== 'false';

/**
 * Pure decision logic — alert on entering 'down', and on recovering from
 * 'down' back to 'up' (not on the first-ever successful check, i.e.
 * unknown -> up, which isn't a "recovery"). Never alerts on transitions
 * to/from 'unknown' otherwise, since that's "no data yet", not a real event.
 */
function shouldAlert(previousStatus, newStatus, { alertsEnabled = true, alertOnRecovery = ALERT_ON_RECOVERY } = {}) {
  if (!alertsEnabled) return false;
  if (newStatus === 'down') return true;
  if (newStatus === 'up' && previousStatus === 'down') return alertOnRecovery;
  return false;
}

/** Slack accepts top-level `text`; Teams' Incoming Webhook connector accepts a MessageCard — this payload satisfies both at once. */
function buildPayload(device, previousStatus, newStatus, at) {
  const isDown = newStatus === 'down';
  const title = `${isDown ? '🔴' : '✅'} ${device.name} is ${newStatus.toUpperCase()}`;
  const detail = `${device.name} (${device.ipAddress}) changed from ${previousStatus} to ${newStatus} at ${at.toISOString()}.`;
  return {
    text: `${title}\n${detail}`,
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: isDown ? 'd03b3b' : '0ca30c',
    summary: title,
    title,
  };
}

/** No-op when ALERT_WEBHOOK_URL isn't configured — alerting is opt-in. */
async function notifyStatusChange(device, previousStatus, newStatus, at = new Date()) {
  if (!WEBHOOK_URL) return;
  if (!shouldAlert(previousStatus, newStatus, { alertsEnabled: device.alertsEnabled !== false })) return;

  try {
    await axios.post(WEBHOOK_URL, buildPayload(device, previousStatus, newStatus, at), { timeout: 5000 });
  } catch (err) {
    console.error('[alerts] failed to send webhook:', err.message);
  }
}

module.exports = { shouldAlert, buildPayload, notifyStatusChange };
