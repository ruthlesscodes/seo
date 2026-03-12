const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const { normalizeDomain } = require('../utils/domain');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

const IntelligenceResearchBody = z.object({
  topic: z.string().min(1),
  depth: z.enum(['shallow', 'deep']).optional()
});

async function intelligenceRoutes(fastify) {

  // POST /api/intelligence/analyze
  // Body: { domain: string, keywords: string[], competitors?: string[] }
  // Uses: search per keyword + map competitors → claude(STRATEGIC_BRIEF)
  fastify.post('/analyze', async (request, reply) => {
    try {
      const body = schemas.IntelligenceAnalyzeBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'analyze.brief');
      if (!allowed) return;

      const keywordData = [];
      for (const kw of body.keywords) {
        const searchRes = await firecrawl.search(kw, { limit: 10 });
        keywordData.push({ keyword: kw, results: searchRes.data?.web || searchRes.data?.results || [] });
      }

      let competitorData = [];
      if (body.competitors && body.competitors.length > 0) {
        for (const comp of body.competitors.slice(0, 5)) {
          try {
            const mapRes = await firecrawl.map(comp, { limit: 50 });
            competitorData.push({ domain: comp, urls: mapRes.data?.links || mapRes.links || [] });
          } catch (_) {}
        }
      }

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.STRATEGIC_BRIEF,
        JSON.stringify({
          domain: body.domain,
          keywordData,
          competitorData
        })
      );

      consumeCredits(request, 'analyze.brief', cost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/intelligence/gaps
  // Body: { domain: string, competitorDomain: string, keywords: string[] }
  fastify.post('/gaps', async (request, reply) => {
    try {
      const body = schemas.IntelligenceGapsBody.parse(request.body);

      const cost = body.keywords.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'intelligence.gaps', cost);
      if (!allowed) return;

      const domainNorm = normalizeDomain(body.domain);
      const compNorm = normalizeDomain(body.competitorDomain);

      const settled = await Promise.allSettled(
        body.keywords.map((kw) => firecrawl.search(kw, { limit: 10 }))
      );

      const gapsData = [];
      for (let i = 0; i < body.keywords.length; i++) {
        const kw = body.keywords[i];
        const s = settled[i];
        if (s.status === 'rejected') {
          gapsData.push({ keyword: kw, domainPosition: null, competitorPosition: null, domainUrl: null, competitorUrl: null, serp: [] });
          continue;
        }
        const webResults = s.value.data?.web || s.value.data?.results || [];
        let domainPos = null;
        let compPos = null;
        let domainUrl = null;
        let compUrl = null;
        for (let j = 0; j < webResults.length; j++) {
          const u = (webResults[j].url || '').toLowerCase().replace(/^https?:\/\//, '');
          if (u.includes(domainNorm) || u.startsWith(domainNorm)) {
            domainPos = j + 1;
            domainUrl = webResults[j].url;
          }
          if (u.includes(compNorm) || u.startsWith(compNorm)) {
            compPos = j + 1;
            compUrl = webResults[j].url;
          }
        }
        gapsData.push({
          keyword: kw,
          domainPosition: domainPos,
          competitorPosition: compPos,
          domainUrl,
          competitorUrl: compUrl,
          serp: webResults.slice(0, 5)
        });
      }

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.GAP_ANALYSIS,
        JSON.stringify({ domain: body.domain, competitorDomain: body.competitorDomain, gapsData })
      );

      consumeCredits(request, 'intelligence.gaps', creditCost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/intelligence/agent — SCALE+
  // Body: { prompt: string, urls?: string[], schema?: object, model?: string }
  fastify.post('/agent', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'intelligence.agent')) return;

      const body = schemas.IntelligenceAgentBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'intelligence.agent');
      if (!allowed) return;

      const agentRes = await firecrawl.agent(body.prompt, {
        urls: body.urls,
        schema: body.schema,
        model: body.model
      });

      const agentId = agentRes.id || agentRes.data?.id;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await firecrawl.getAgentStatus(agentId);
        const s = status.status || status.data?.status;
        if (s === 'completed') {
          consumeCredits(request, 'intelligence.agent', cost);
          return {
            success: true,
            data: status.data || status.result || status,
            meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
          };
        }
        if (s === 'failed') {
          return reply.code(502).send({
            error: 'agent_failed',
            message: status.error || 'Agent job failed'
          });
        }
      }

      return reply.code(504).send({
        error: 'timeout',
        message: 'Agent job did not complete in time. No credits charged.',
        agentId
      });
    } catch (err) {
      throw err;
    }
  });

  // POST /api/intelligence/research
  // Body: { topic: string, depth?: "shallow"|"deep" }
  fastify.post('/research', async (request, reply) => {
    try {
      const body = IntelligenceResearchBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'intelligence.agent');
      if (!allowed) return;

      const model = body.depth === 'deep' ? 'spark-1-pro' : 'spark-1-mini';
      const agentRes = await firecrawl.agent(body.topic, { model, maxCredits: 50 });

      const agentId = agentRes.id || agentRes.data?.id;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await firecrawl.getAgentStatus(agentId);
        const s = status.status || status.data?.status;
        if (s === 'completed') {
          consumeCredits(request, 'intelligence.agent', cost);
          return {
            success: true,
            data: status.data || status.result || status,
            meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
          };
        }
        if (s === 'failed') {
          return reply.code(502).send({
            error: 'research_failed',
            message: status.error || 'Research failed'
          });
        }
      }

      return reply.code(504).send({
        error: 'timeout',
        message: 'Research job did not complete in time. No credits charged.',
        agentId
      });
    } catch (err) {
      throw err;
    }
  });

  // POST /api/intelligence/batch — GROWTH+
  // Body: { prompts: [{ topic, depth? }], model?: string }
  // Uses: firecrawl.agent() in parallel for each prompt
  fastify.post('/batch', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'intelligence.batch')) return;

      const body = schemas.IntelligenceBatchBody.parse(request.body);

      const cost = body.prompts.length * 20;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'intelligence.batch', body.prompts.length);
      if (!allowed) return;

      const model = body.model || 'spark-1-mini';

      const agentPromises = body.prompts.map(p => {
        const agentRes = firecrawl.agent(p.topic, {
          model: p.depth === 'deep' ? 'spark-1-pro' : model,
          maxCredits: 50
        });
        return agentRes.then(res => ({ prompt: p, agentRes: res }));
      });

      const started = await Promise.all(agentPromises);
      const agentIds = started.map(s => s.agentRes.id || s.agentRes.data?.id);

      const results = [];
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statuses = await Promise.all(agentIds.map(id => firecrawl.getAgentStatus(id)));
        const allDone = statuses.every(s => (s.status || s.data?.status) === 'completed' || (s.status || s.data?.status) === 'failed');
        if (allDone) {
          for (let j = 0; j < statuses.length; j++) {
            const s = statuses[j];
            results.push({
              topic: body.prompts[j].topic,
              status: s.status || s.data?.status,
              data: s.data || s.result || s
            });
          }
          break;
        }
      }

      if (results.length === 0) {
        results.push(...body.prompts.map((p, i) => ({
          topic: p.topic,
          status: 'timeout',
          agentId: agentIds[i]
        })));
      }

      consumeCredits(request, 'intelligence.batch', creditCost);

      return {
        success: true,
        data: { results },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = intelligenceRoutes;
