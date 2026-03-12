const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

async function contentRoutes(fastify) {

  // POST /api/content/generate
  // Body: { keyword: string, segment?: string, tone?: string, targetWordCount? }
  // Uses: firecrawl.search(keyword) for research → claude(CONTENT_GENERATE) → store BlogDraft
  fastify.post('/generate', async (request, reply) => {
    try {
      const body = schemas.ContentGenerateBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'blog.generate');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.keyword, {
        limit: 5,
        scrapeOptions: { formats: ['markdown'] }
      });
      const webResults = searchRes.data?.web || searchRes.data?.results || [];
      const contentSummaries = webResults
        .slice(0, 5)
        .map(r => `${r.title || ''}\n${(r.markdown || r.description || '').slice(0, 500)}`)
        .join('\n\n---\n\n');

      const userPrompt = `Keyword: ${body.keyword}\nSegment: ${body.segment}\nTone: ${body.tone}\nTarget word count: ${body.targetWordCount}\n\nCompetitor content summaries:\n${contentSummaries}`;
      const content = await claude.analyze(
        claude.PROMPTS.CONTENT_GENERATE,
        userPrompt,
        { maxTokens: 8192 }
      );

      const title = content.split('\n')[0]?.replace(/^#+\s*/, '') || `Content for ${body.keyword}`;
      const wordCount = content.split(/\s+/).filter(Boolean).length;

      const draft = await prisma.blogDraft.create({
        data: {
          orgId: request.org.id,
          title,
          targetKeyword: body.keyword,
          content,
          segment: body.segment,
          wordCount,
          status: 'DRAFT'
        }
      });

      consumeCredits(request, 'blog.generate', cost);

      return {
        success: true,
        data: {
          id: draft.id,
          title,
          content,
          targetKeyword: body.keyword,
          wordCount,
          status: 'DRAFT'
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/content/brief
  // Body: { keyword: string, competitors?: string[] }
  // Uses: firecrawl.search(keyword, scrapeOptions) → scrape top 3 → claude(CONTENT_BRIEF)
  fastify.post('/brief', async (request, reply) => {
    try {
      const body = schemas.ContentBriefBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'content.brief');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.keyword, {
        limit: 5,
        scrapeOptions: { formats: ['markdown'] }
      });
      const webResults = searchRes.data?.web || searchRes.data?.results || [];
      const top3 = webResults.slice(0, 3);
      const contentParts = top3.map(r => `[${r.title || r.url}]\n${(r.markdown || r.description || '').slice(0, 1000)}`);
      const contentForBrief = contentParts.join('\n\n---\n\n');

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.CONTENT_BRIEF,
        JSON.stringify({ keyword: body.keyword, competitorContent: contentForBrief, competitors: body.competitors })
      );

      consumeCredits(request, 'content.brief', cost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/content/refresh
  // Body: { url: string, keyword: string }
  // Uses: firecrawl.scrape(url) + firecrawl.search(keyword) → claude(CONTENT_REFRESH)
  fastify.post('/refresh', async (request, reply) => {
    try {
      const body = schemas.ContentRefreshBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'blog.refresh');
      if (!allowed) return;

      const [scrapeRes, searchRes] = await Promise.all([
        firecrawl.scrape(body.url, { formats: ['markdown'] }),
        firecrawl.search(body.keyword, { limit: 5 })
      ]);

      const existingContent = scrapeRes.data?.markdown || scrapeRes.markdown || JSON.stringify(scrapeRes);
      const serpData = searchRes.data?.web || searchRes.data?.results || [];

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.CONTENT_REFRESH,
        JSON.stringify({
          url: body.url,
          keyword: body.keyword,
          existingContent,
          currentSerp: serpData
        })
      );

      consumeCredits(request, 'blog.refresh', cost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/content/trending — GROWTH+
  // Body: { topic: string, timeRange?: "day"|"week"|"month" }
  // Uses: firecrawl.search(topic, { tbs, sources: ["web", "news"] })
  fastify.post('/trending', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'trending')) return;

      const body = schemas.ContentTrendingBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'search.trending');
      if (!allowed) return;

      const tbsMap = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m' };
      const tbs = tbsMap[body.timeRange] || 'qdr:w';

      const searchRes = await firecrawl.search(body.topic, {
        sources: ['web', 'news'],
        tbs,
        limit: 10
      });

      const webResults = searchRes.data?.web || searchRes.data?.results || [];
      const newsResults = searchRes.data?.news || [];

      consumeCredits(request, 'search.trending', cost);

      return {
        success: true,
        data: {
          topic: body.topic,
          timeRange: body.timeRange,
          web: webResults.map(r => ({
            title: r.title || r.name,
            url: r.url,
            description: r.description || r.snippet,
            date: r.date,
            position: r.position
          })),
          news: newsResults.map(r => ({
            title: r.title || r.name,
            url: r.url,
            snippet: r.snippet || r.description,
            date: r.date,
            position: r.position
          }))
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = contentRoutes;
