const { z } = require('zod');
const Stripe = require('stripe');
const { prisma } = require('../utils/prisma');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const UpgradeBody = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE'])
});

const PLAN_PRICE_IDS = {
  STARTER: process.env.STRIPE_STARTER_PRICE_ID,
  GROWTH: process.env.STRIPE_GROWTH_PRICE_ID,
  SCALE: process.env.STRIPE_SCALE_PRICE_ID
};

function priceIdToPlan(priceId) {
  if (!priceId) return null;
  const map = {
    [process.env.STRIPE_STARTER_PRICE_ID]: 'STARTER',
    [process.env.STRIPE_GROWTH_PRICE_ID]: 'GROWTH',
    [process.env.STRIPE_SCALE_PRICE_ID]: 'SCALE'
  };
  return map[priceId] || null;
}

async function billingRoutes(fastify) {

  // Store raw body for webhook verification
  fastify.addHook('preParsing', async (request, reply, payload) => {
    if (request.url === '/api/billing/webhook' && request.method === 'POST') {
      const chunks = [];
      for await (const chunk of payload) chunks.push(chunk);
      request.rawBody = Buffer.concat(chunks).toString('utf8');
      const { Readable } = require('stream');
      return Readable.from([request.rawBody]);
    }
  });

  // GET /api/billing/plans
  fastify.get('/plans', async (request, reply) => {
    const { PLAN_LIMITS, CREDIT_COSTS } = require('../utils/constants');
    return { plans: PLAN_LIMITS, creditCosts: CREDIT_COSTS };
  });

  // POST /api/billing/upgrade — Stripe checkout session
  fastify.post('/upgrade', async (request, reply) => {
    try {
      const body = UpgradeBody.parse(request.body);

      const priceId = PLAN_PRICE_IDS[body.plan];
      if (!priceId) {
        return reply.code(400).send({
          error: 'config_error',
          message: `Stripe price ID not configured for plan ${body.plan}`
        });
      }
      if (!stripe) {
        return reply.code(503).send({ error: 'billing_unavailable', message: 'Stripe not configured' });
      }

      let customerId = null;
      const org = await prisma.organization.findUnique({
        where: { id: request.org.id }
      });
      if (org?.stripeCustomerId) {
        customerId = org.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          metadata: { orgId: request.org.id }
        });
        customerId = customer.id;
        await prisma.organization.update({
          where: { id: request.org.id },
          data: { stripeCustomerId: customerId }
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: process.env.STRIPE_SUCCESS_URL || `${process.env.APP_URL || 'https://app.seoagent.dev'}/billing/success`,
        cancel_url: process.env.STRIPE_CANCEL_URL || `${process.env.APP_URL || 'https://app.seoagent.dev'}/billing`,
        metadata: { orgId: request.org.id, plan: body.plan }
      });

      return {
        success: true,
        data: { checkoutUrl: session.url, sessionId: session.id }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/billing/webhook — Stripe webhook handler (PUBLIC, no auth)
  fastify.post('/webhook', async (request, reply) => {
    try {
      if (!stripe) {
        return reply.code(503).send({ error: 'billing_unavailable', message: 'Stripe not configured' });
      }
      const sig = request.headers['stripe-signature'];
      const rawBody = request.rawBody || JSON.stringify(request.body || {});

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          rawBody,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (e) {
        request.log.warn({ err: e }, 'Webhook signature verification failed');
        return reply.code(400).send({ error: 'invalid_signature' });
      }

      const redis = request.server.redis;

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const orgId = session.metadata?.orgId;
          let plan = session.metadata?.plan || null;
          if (!plan && session.subscription) {
            try {
              const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ['items.data.price'] });
              const priceId = sub.items?.data?.[0]?.price?.id;
              plan = priceIdToPlan(priceId) || 'STARTER';
            } catch (e) {
              request.log.warn({ err: e }, 'Could not derive plan from subscription');
              plan = 'STARTER';
            }
          }
          if (orgId && plan) {
            await prisma.organization.update({
              where: { id: orgId },
              data: {
                plan,
                stripeCustomerId: session.customer,
                stripeSubId: session.subscription
              }
            });
            const keys = await prisma.apiKey.findMany({ where: { orgId }, select: { key: true } });
            for (const k of keys) await redis.del(`auth:${k.key}`);
          }
          break;
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object;
          const org = await prisma.organization.findFirst({ where: { stripeSubId: sub.id } });
          if (org) {
            const priceId = sub.items?.data?.[0]?.price?.id;
            const plan = priceIdToPlan(priceId) || org.plan;
            await prisma.organization.update({
              where: { id: org.id },
              data: { plan }
            });
            const keys = await prisma.apiKey.findMany({ where: { orgId: org.id }, select: { key: true } });
            for (const k of keys) await redis.del(`auth:${k.key}`);
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object;
          const org = await prisma.organization.findFirst({ where: { stripeSubId: sub.id } });
          if (org) {
            await prisma.organization.update({
              where: { id: org.id },
              data: { plan: 'FREE', stripeSubId: null }
            });
            const keys = await prisma.apiKey.findMany({ where: { orgId: org.id }, select: { key: true } });
            for (const k of keys) await redis.del(`auth:${k.key}`);
          }
          break;
        }
        default:
          request.log.debug({ type: event.type }, 'Unhandled webhook event');
      }

      return { received: true };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = billingRoutes;
