const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');
const fcSchemas = require('../schemas/firecrawl');

const MonitorDiffBody = z.object({ url: z.string().url() });
const MonitorDecayBody = z.object({
  domain: z.string().min(3),
  keywords: z.array(z.string().min(1)).optional()
});

const FREQ_MAP = { hourly: 'HOURLY', daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };

async function monitorRoutes(fastify) {

  // POST /api/monitor/watch — register URL to monitor
  // Body: { url: string, label?: string, frequency? }
  // Stores: MonitoredUrl
  fastify.post('/watch', async (request, reply) => {
    try {
      const body = schemas.MonitorWatchBody.parse(request.body);

      const maxMonitored = request.planLimits?.maxMonitoredURLs ?? 3;
      const count = await prisma.monitoredUrl.count({ where: { orgId: request.org.id } });
      if (count >= maxMonitored) {
        return reply.code(400).send({
          error: 'limit_exceeded',
          message: `Plan allows max ${maxMonitored} monitored URLs.`,
          maxMonitoredURLs: maxMonitored
        });
      }

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'monitor.watch');
      if (!allowed) return;

      const freq = FREQ_MAP[body.frequency] || 'DAILY';

      const monitored = await prisma.monitoredUrl.upsert({
        where: { orgId_url: { orgId: request.org.id, url: body.url } },
        create: {
          orgId: request.org.id,
          url: body.url,
          label: body.label,
          checkFrequency: freq
        },
        update: { label: body.label, checkFrequency: freq, isActive: true }
      });

      consumeCredits(request, 'monitor.watch', cost);

      return {
        success: true,
        data: monitored,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // POST /api/monitor/check — run change detection on monitored URLs
  // Body: { urls?: string[] } (empty = check all active)
  // Uses: firecrawl.scrape(url, { changeTrackingModes: ["git-diff"] })
  // Stores: ChangeEvent
  fastify.post('/check', async (request, reply) => {
    try {
      const body = schemas.MonitorCheckBody.parse(request.body);

      let urlsToCheck = [];
      if (body.urls && body.urls.length > 0) {
        const records = await prisma.monitoredUrl.findMany({
          where: { orgId: request.org.id, url: { in: body.urls }, isActive: true }
        });
        urlsToCheck = records.map(r => r.url);
      } else {
        const records = await prisma.monitoredUrl.findMany({
          where: { orgId: request.org.id, isActive: true }
        });
        urlsToCheck = records.map(r => r.url);
      }

      const cost = urlsToCheck.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'monitor.check', cost);
      if (!allowed) return;

      const changes = [];
      const tag = `org_${request.org.id}`;

      for (const url of urlsToCheck) {
        try {
          const result = await firecrawl.scrape(url, {
            formats: ['markdown'],
            changeTrackingModes: ['git-diff'],
            changeTrackingTag: tag
          });

          const ct = result.data?.changeTracking || result.changeTracking;
          const changeStatus = ct?.changeStatus || 'unchanged';
          const monitored = await prisma.monitoredUrl.findFirst({
            where: { orgId: request.org.id, url }
          });
          if (!monitored) continue;

          await prisma.monitoredUrl.update({
            where: { id: monitored.id },
            data: { lastCheckedAt: new Date(), ...(changeStatus !== 'unchanged' ? { lastChangeAt: new Date() } : {}) }
          });

          if (changeStatus === 'changed' || changeStatus === 'new') {
            const event = await prisma.changeEvent.create({
              data: {
                monitoredUrlId: monitored.id,
                changeStatus,
                changeType: 'content',
                diff: ct?.diff || null
              }
            });
            changes.push({ url, changeStatus, eventId: event.id });
          }
        } catch (e) {
          request.log.warn({ url, err: e }, 'Monitor check failed for URL');
        }
      }

      consumeCredits(request, 'monitor.check', creditCost);

      return {
        success: true,
        data: { changes, checked: urlsToCheck.length },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // GET /api/monitor/changes — list detected changes
  // Query: { since?, url?, changeType?, limit?, cursor? }
  fastify.get('/changes', async (request, reply) => {
    try {
      const since = request.query.since ? new Date(request.query.since) : null;
      const url = request.query.url;
      const changeType = request.query.changeType;
      const limit = Math.min(parseInt(request.query.limit, 10) || 50, 100);

      const where = { monitoredUrl: { orgId: request.org.id } };
      if (since) where.detectedAt = { gte: since };
      if (url) where.monitoredUrl = { orgId: request.org.id, url };
      if (changeType) where.changeType = changeType;

      const events = await prisma.changeEvent.findMany({
        where,
        include: { monitoredUrl: true },
        orderBy: { detectedAt: 'desc' },
        take: limit + 1
      });

      const hasMore = events.length > limit;
      const items = hasMore ? events.slice(0, limit) : events;

      return {
        success: true,
        data: items,
        meta: { hasMore, count: items.length }
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // POST /api/monitor/diff — get detailed diff for a URL
  // Body: { url: string }
  fastify.post('/diff', async (request, reply) => {
    try {
      const body = MonitorDiffBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'monitor.diff');
      if (!allowed) return;

      const result = await firecrawl.scrape(body.url, {
        formats: ['markdown'],
        changeTrackingModes: ['git-diff'],
        changeTrackingTag: `org_${request.org.id}`
      });

      consumeCredits(request, 'monitor.diff', cost);

      return {
        success: true,
        data: result.data?.changeTracking || result.changeTracking || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // POST /api/monitor/pricing — GROWTH+
  // Body: { url: string, schema?: object }
  fastify.post('/pricing', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'monitor.pricing')) return;

      const body = schemas.MonitorPricingBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'monitor.pricing');
      if (!allowed) return;

      const schema = body.schema || fcSchemas.PRICING_MONITOR_SCHEMA;
      const result = await firecrawl.scrape(body.url, {
        formats: ['markdown'],
        jsonSchema: schema,
        changeTrackingModes: ['json'],
        changeTrackingSchema: schema,
        changeTrackingTag: `org_${request.org.id}_pricing`
      });

      const monitored = await prisma.monitoredUrl.findFirst({
        where: { orgId: request.org.id, url: body.url }
      });
      if (monitored) {
        const ct = result.data?.changeTracking || result.changeTracking;
        if (ct && (ct.changeStatus === 'changed' || ct.changeStatus === 'new')) {
          await prisma.changeEvent.create({
            data: {
              monitoredUrlId: monitored.id,
              changeStatus: ct.changeStatus,
              changeType: 'pricing',
              structuredDiff: ct.structuredDiff || ct.data
            }
          });
        }
      }

      consumeCredits(request, 'monitor.pricing', cost);

      return {
        success: true,
        data: result.data || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // POST /api/monitor/decay — GROWTH+
  // Body: { domain: string, keywords?: string[] }
  fastify.post('/decay', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'monitor.decay')) return;

      const body = MonitorDecayBody.parse(request.body);

      const keywords = body.keywords
        ? await prisma.keyword.findMany({ where: { orgId: request.org.id, keyword: { in: body.keywords } } })
        : await prisma.keyword.findMany({ where: { orgId: request.org.id } });

      const cost = keywords.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'monitor.decay', cost);
      if (!allowed) return;

      const domainLower = body.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const decaying = [];
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      for (const kw of keywords) {
        const [currentSnap, oldSnap] = await Promise.all([
          prisma.rankSnapshot.findFirst({
            where: { keywordId: kw.id },
            orderBy: { checkedAt: 'desc' }
          }),
          prisma.rankSnapshot.findFirst({
            where: { keywordId: kw.id, checkedAt: { lte: weekAgo } },
            orderBy: { checkedAt: 'desc' }
          })
        ]);

        if (!currentSnap || !oldSnap) continue;
        const prevPos = oldSnap.position;
        const currPos = currentSnap.position;
        if (prevPos != null && currPos != null && currPos - prevPos >= 3) {
          decaying.push({
            keyword: kw.keyword,
            previousPosition: prevPos,
            currentPosition: currPos,
            drop: currPos - prevPos,
            url: currentSnap.url
          });
        }
      }

      consumeCredits(request, 'monitor.decay', creditCost);

      return {
        success: true,
        data: { decaying },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });
}

module.exports = monitorRoutes;
