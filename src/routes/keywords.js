const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

async function keywordRoutes(fastify) {

  // POST /api/keywords/search
  // Body: { keywords: string[], domain: string, location?, country?, tbs? }
  // Uses: firecrawl.search() per keyword → find position of domain in results
  // Returns: [{ keyword, position, url, topResults[], opportunityScore }]
  fastify.post('/search', async (request, reply) => {
    try {
      const body = schemas.KeywordSearchBody.parse(request.body);

      const maxKeywords = request.planLimits?.maxKeywordsPerCall ?? 5;
      if (body.keywords.length > maxKeywords) {
        return reply.code(400).send({
          error: 'limit_exceeded',
          message: `Plan allows max ${maxKeywords} keywords per call.`,
          maxKeywordsPerCall: maxKeywords
        });
      }

      const cost = body.keywords.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'keyword.search', cost);
      if (!allowed) return;

      const country = body.country || body.region || 'US';
      const opts = { limit: 10, country };
      if (body.location) opts.location = body.location;
      if (body.tbs) opts.tbs = body.tbs;

      const results = [];
      const domainLower = body.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

      for (const keyword of body.keywords) {
        const searchRes = await firecrawl.search(keyword, opts);
        const webResults = searchRes.data?.web || searchRes.data?.results || [];
        const topResults = webResults.slice(0, 5).map((r, i) => ({
          title: r.title || r.name,
          url: r.url,
          position: r.position ?? i + 1
        }));

        let position = null;
        let rankingUrl = null;
        for (let i = 0; i < webResults.length; i++) {
          const r = webResults[i];
          const resultUrl = (r.url || '').toLowerCase();
          if (resultUrl.includes(domainLower) || resultUrl.replace(/^https?:\/\//, '').startsWith(domainLower)) {
            position = r.position ?? i + 1;
            rankingUrl = r.url;
            break;
          }
        }

        const opportunityScore = (position === null || position > 10) ? 'high' : (position > 5 ? 'medium' : 'low');

        const kw = await prisma.keyword.upsert({
          where: { orgId_keyword: { orgId: request.org.id, keyword } },
          create: { orgId: request.org.id, keyword },
          update: { lastPosition: position, lastCheckedAt: new Date() }
        });

        await prisma.rankSnapshot.create({
          data: {
            orgId: request.org.id,
            keywordId: kw.id,
            position,
            url: rankingUrl,
            region: country,
            topResults
          }
        });

        results.push({
          keyword,
          position,
          url: rankingUrl,
          topResults,
          opportunityScore
        });
      }

      consumeCredits(request, 'keyword.search', creditCost);

      return {
        success: true,
        data: results,
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

  // POST /api/keywords/cluster
  // Body: { keywords: string[] }
  // Uses: claude.analyzeJSON(PROMPTS.KEYWORD_CLUSTER, keywords)
  // Returns: { clusters: [{ intent, keywords[], suggestedPillarTopic }] }
  fastify.post('/cluster', async (request, reply) => {
    try {
      const body = schemas.KeywordClusterBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'keyword.cluster');
      if (!allowed) return;

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.KEYWORD_CLUSTER,
        JSON.stringify({ keywords: body.keywords })
      );

      const validIntents = ['INFORMATIONAL', 'TRANSACTIONAL', 'NAVIGATIONAL', 'COMMERCIAL'];
      if (analysis.clusters) {
        for (const cluster of analysis.clusters) {
          const intentVal = validIntents.includes((cluster.intent || '').toUpperCase())
            ? cluster.intent.toUpperCase() : null;
          if (intentVal) {
            for (const kw of cluster.keywords || []) {
              await prisma.keyword.updateMany({
                where: { orgId: request.org.id, keyword: kw },
                data: { intent: intentVal }
              });
            }
          }
        }
      }

      consumeCredits(request, 'keyword.cluster', cost);

      return {
        success: true,
        data: analysis,
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

  // POST /api/keywords/suggest
  // Body: { topic: string, count?: number }
  // Uses: firecrawl.search(topic) → claude.analyzeJSON() to extract keyword ideas
  // Returns: { suggestions: [{ keyword, estimatedDifficulty, intent }] }
  fastify.post('/suggest', async (request, reply) => {
    try {
      const body = schemas.KeywordSuggestBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'keyword.suggest');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.topic, {
        limit: 10,
        scrapeOptions: { formats: ['markdown'] }
      });

      const suggestPrompt = `Based on these top results for "${body.topic}", suggest ${body.count} related keywords with difficulty (easy/medium/hard) and intent (INFORMATIONAL/TRANSACTIONAL/NAVIGATIONAL/COMMERCIAL). Return JSON: { suggestions: [{ keyword, estimatedDifficulty, intent }] }`;
      const analysis = await claude.analyzeJSON(
        'You are an SEO keyword strategist. Return ONLY valid JSON.',
        JSON.stringify(searchRes) + '\n\n' + suggestPrompt
      );

      consumeCredits(request, 'keyword.suggest', cost);

      return {
        success: true,
        data: analysis,
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
}

module.exports = keywordRoutes;
