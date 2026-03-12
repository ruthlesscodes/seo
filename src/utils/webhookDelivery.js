/**
 * Webhook delivery utility
 * POSTs to configured webhook URLs with HMAC-SHA256 signature in x-webhook-signature.
 * Stores WebhookDelivery record and retries up to 3 times with exponential backoff.
 */

const crypto = require('crypto');
const { prisma } = require('./prisma');

async function deliverWebhook(orgId, event, payload) {
  const configs = await prisma.webhookConfig.findMany({
    where: { orgId, isActive: true }
  });

  for (const config of configs) {
    const events = Array.isArray(config.events) ? config.events : [];
    if (!events.includes(event)) continue;

    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const secret = config.secret && String(config.secret).trim();
    const signature = secret
      ? crypto.createHmac('sha256', secret).update(payloadStr).digest('hex')
      : null;

    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookConfigId: config.id,
        event,
        payload: typeof payload === 'object' ? payload : JSON.parse(payloadStr),
        attempts: 0
      }
    });

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
    const headers = {
      'Content-Type': 'application/json',
      'x-webhook-event': event
    };
    if (signature) headers['x-webhook-signature'] = signature;

        const res = await fetch(config.url, {
          method: 'POST',
          headers,
          body: payloadStr
        });

        const responseText = await res.text();

        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            statusCode: res.status,
            response: responseText.slice(0, 10000),
            attempts: attempt,
            deliveredAt: res.ok ? new Date() : null
          }
        });

        if (res.ok) break;

        if (attempt < maxAttempts) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, backoff));
        }
      } catch (err) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            response: err.message?.slice(0, 1000) || 'Request failed',
            attempts: attempt
          }
        });
        if (attempt < maxAttempts) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
  }
}

module.exports = { deliverWebhook };
