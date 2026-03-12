const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const { normalizeDomain } = require('../utils/domain');
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

      const domainNorm = normalizeDomain(body.domain);
      const settled = await Promise.allSettled(
        body.keywords.map((kw) => firecrawl.search(kw, opts))
      );

      const results = [];
      const dbPromises = [];
      for (let i = 0; i < body.keywords.length; i++) {
        const keyword = body.keywords[i];
        const s = settled[i];
        if (s.status === 'rejected') {
          results.push({ keyword, position: null, url: null, topResults: [], opportunityScore: 'high' });
          continue;
        }
        const webResults = s.value.data?.web || s.value.data?.results || [];
        const topResults = webResults.slice(0, 5).map((r, idx) => ({
          title: r.title || r.name,
          url: r.url,
          position: r.position ?? idx + 1
        }));
        let position = null;
        let rankingUrl = null;
        for (let j = 0; j < webResults.length; j++) {
          const r = webResults[j];
          const resultUrl = (r.url || '').toLowerCase();
          const u = resultUrl.replace(/^https?:\/\//, '');
          if (u.includes(domainNorm) || u.startsWith(domainNorm)) {
            position = r.position ?? j + 1;
            rankingUrl = r.url;
            break;
          }
        }
        const opportunityScore = (position === null || position > 10) ? 'high' : (position > 5 ? 'medium' : 'low');

        const upsertPromise = prisma.keyword
          .upsert({
            where: { orgId_keyword: { orgId: request.org.id, keyword } },
            create: { orgId: request.org.id, keyword },
            update: { lastPosition: position, lastCheckedAt: new Date() }
          })
          .then((kw) =>
            prisma.rankSnapshot.create({
              data: {
                orgId: request.org.id,
                keywordId: kw.id,
                position,
                url: rankingUrl,
                region: country,
                topResults
              }
            })
          );
        dbPromises.push(upsertPromise);
        results.push({ keyword, position, url: rankingUrl, topResults, opportunityScore });
      }
      await Promise.all(dbPromises);

      consumeCredits(request, 'keyword.search', creditCost);

      return {
        success: true,
        data: results,
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
      };
  });

  // POST /api/keywords/cluster
  // Body: { keywords: string[] }
  // Uses: claude.analyzeJSON(PROMPTS.KEYWORD_CLUSTER, keywords)
  // Returns: { clusters: [{ intent, keywords[], suggestedPillarTopic }] }
  fastify.post('/cluster', async (request, reply) => {
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
  });

  // POST /api/keywords/suggest
  // Body: { topic: string, count?: number }
  // Uses: firecrawl.search(topic) → claude.analyzeJSON() to extract keyword ideas
  // Returns: { suggestions: [{ keyword, estimatedDifficulty, intent }] }
  fastify.post('/suggest', async (request, reply) => {
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
  });
}

module.exports = keywordRoutes;
