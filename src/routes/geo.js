const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

async function geoRoutes(fastify) {

  // POST /api/geo/brand-monitor — SCALE+
  // Body: { brand: string, competitors?: string[], queries?: string[] }
  fastify.post('/brand-monitor', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'geo.brand-monitor')) return;

      const body = schemas.GeoBrandMonitorBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'geo.brand-monitor');
      if (!allowed) return;

      const queries = body.queries && body.queries.length > 0
        ? body.queries
        : [`best ${body.brand}`, `top ${body.brand} for professionals`];

      const results = [];
      for (const q of queries.slice(0, 5)) {
        const agentRes = await firecrawl.agent(
          `Search for "${q}" on Perplexity, Google AI Overviews, and ChatGPT. Check if "${body.brand}" is mentioned. Note which competitor brands are cited.`,
          { model: 'spark-1-mini', maxCredits: 50 }
        );
        const agentId = agentRes.id || agentRes.data?.id;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const status = await firecrawl.getAgentStatus(agentId);
          if (status.status === 'completed' || status.data?.status === 'completed') {
            results.push({ query: q, data: status.data || status.result });
            break;
          }
        }
      }

      const analysis = await claude.analyzeJSON(
        'Analyze AI platform citation results. Return JSON: { brandCited: boolean, citationRate: 0-100, competitorMentions: string[], recommendations: string[] }',
        JSON.stringify({ brand: body.brand, results })
      );

      await prisma.geoReport.create({
        data: {
          orgId: request.org.id,
          reportType: 'BRAND_MONITOR',
          domain: body.brand,
          score: analysis.citationRate,
          data: { results, analysis }
        }
      });

      consumeCredits(request, 'geo.brand-monitor', cost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/geo/readability — GROWTH+
  fastify.post('/readability', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'geo.readability')) return;

      const body = schemas.GeoReadabilityBody.parse(request.body);

      let urls = [];
      if (body.url) {
        urls = [body.url];
      } else {
        const mapUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
        const mapRes = await firecrawl.map(mapUrl, { limit: body.maxPages });
        urls = (mapRes.data?.links || mapRes.links || []).slice(0, body.maxPages);
      }

      const cost = urls.length * 10;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'geo.readability', urls.length);
      if (!allowed) return;

      const reports = [];
      for (const url of urls) {
        const scrapeRes = await firecrawl.scrape(url, { formats: ['markdown'] });
        const content = scrapeRes.data?.markdown || scrapeRes.markdown || '';
        const analysis = await claude.analyzeJSON(
          claude.PROMPTS.GEO_READABILITY,
          JSON.stringify({ url, content })
        );
        reports.push({ url, ...analysis });
      }

      const avgScore = reports.length
        ? Math.round(reports.reduce((s, r) => s + (r.score || 0), 0) / reports.length)
        : 0;
      const domain = body.domain || (body.url ? new URL(body.url).hostname : 'unknown');

      await prisma.geoReport.create({
        data: {
          orgId: request.org.id,
          reportType: 'READABILITY',
          domain,
          score: avgScore,
          data: reports,
          recommendations: reports.flatMap(r => r.recommendations || [])
        }
      });

      consumeCredits(request, 'geo.readability', creditCost);

      return {
        success: true,
        data: { score: avgScore, reports },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/geo/llmstxt — GROWTH+
  fastify.post('/llmstxt', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'geo.llmstxt')) return;

      const body = schemas.GeoLlmstxtBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'geo.llmstxt');
      if (!allowed) return;

      const mapUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
      const mapRes = await firecrawl.map(mapUrl, { limit: body.maxUrls });
      const urls = (mapRes.data?.links || mapRes.links || []).slice(0, body.maxUrls);

      if (urls.length === 0) {
        return reply.code(404).send({ error: 'no_urls', message: 'No URLs found for domain' });
      }

      const batchRes = await firecrawl.batchScrape(urls, {
        formats: ['markdown', 'summary']
      });
      const batchId = batchRes.id || batchRes.data?.id;

      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await firecrawl.getBatchStatus(batchId);
        if (status.status === 'completed' || status.data?.status === 'completed') {
          const completed = status.data?.data || status.data?.completed || status.results || [];
          const pages = completed.map(p => ({
            url: p.url || p.metadata?.url,
            title: p.metadata?.title || p.title || 'Untitled',
            summary: p.summary || (p.markdown || '').slice(0, 200)
          }));

          const llmsTxt = `# ${body.domain} llms.txt\n\n> AI-readable site index for LLM citation.\n\n## Pages\n\n${pages.map(p => `- [${p.title}](${p.url}): ${p.summary}`).join('\n')}`;
          const llmsFull = `# ${body.domain} llms-full.txt\n\n${pages.map(p => `## [${p.title}](${p.url})\n\n${(completed.find(c => (c.url || c.metadata?.url) === p.url)?.markdown || '').slice(0, 3000)}`).join('\n\n---\n\n')}`;

          await prisma.geoReport.create({
            data: {
              orgId: request.org.id,
              reportType: 'LLMSTXT',
              domain: body.domain,
              data: { llmsTxt, llmsFull, pages }
            }
          });

          consumeCredits(request, 'geo.llmstxt', cost);

          return {
            success: true,
            data: { llmsTxt, llmsFull, urlCount: pages.length },
            meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
          };
        }
      }

      return reply.code(504).send({
        error: 'timeout',
        message: 'Batch scrape did not complete. No credits charged.'
      });
    } catch (err) {
      throw err;
    }
  });

  // POST /api/geo/optimize — SCALE+
  fastify.post('/optimize', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'geo.optimize')) return;

      const body = schemas.GeoOptimizeBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'geo.optimize');
      if (!allowed) return;

      const mapUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
      const mapRes = await firecrawl.map(mapUrl, { limit: 30 });
      const urls = (mapRes.data?.links || mapRes.links || []).slice(0, 10);
      const contentParts = [];
      for (const url of urls) {
        try {
          const s = await firecrawl.scrape(url, { formats: ['markdown'] });
          contentParts.push({ url, content: (s.data?.markdown || '').slice(0, 1500) });
        } catch (_) {}
      }

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.GEO_CITATION,
        JSON.stringify({
          domain: body.domain,
          brand: body.brand,
          keywords: body.keywords,
          pageContent: contentParts
        })
      );

      await prisma.geoReport.create({
        data: {
          orgId: request.org.id,
          reportType: 'CITATION_OPTIMIZATION',
          domain: body.domain,
          score: analysis.citationLikelihood,
          data: analysis
        }
      });

      consumeCredits(request, 'geo.optimize', cost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = geoRoutes;
