/**
 * BullMQ worker for pipeline jobs
 * Processes: search → crawl → analyze → generate
 * Updates ScrapeRun status, delivers webhook on completion
 */

require('dotenv').config();
const { Worker } = require('bullmq');
const { redis } = require('../utils/redis');
const { prisma } = require('../utils/prisma');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { deliverWebhook } = require('../utils/webhookDelivery');

const QUEUE_NAME = 'pipeline';

async function processPipelineJob(job) {
  const { scrapeRunId } = job.data;
  const scrapeRun = await prisma.scrapeRun.findUnique({ where: { id: scrapeRunId } });
  if (!scrapeRun || scrapeRun.jobType !== 'pipeline') {
    throw new Error('Invalid pipeline job');
  }

  const config = scrapeRun.config || {};
  const { domain, keywords = [], competitors = [], region = 'US', orgId } = config;
  if (!orgId || !domain) {
    throw new Error('Missing orgId or domain in config');
  }

  await prisma.scrapeRun.update({
    where: { id: scrapeRunId },
    data: { status: 'RUNNING' }
  });

  const result = { rankings: [], competitorInsights: [], strategicBrief: null, blogDraft: null };

  try {
    // Step 1: firecrawl.search per keyword → RankSnapshot
    for (const kw of keywords) {
      try {
        const searchRes = await firecrawl.search(kw, { limit: 10, country: region });
        const webResults = searchRes.data?.web || searchRes.data?.results || [];
        const domainLower = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        let position = null;
        let rankingUrl = null;
        for (let i = 0; i < webResults.length; i++) {
          const r = webResults[i];
          const u = (r.url || '').toLowerCase();
          if (u.includes(domainLower) || u.replace(/^https?:\/\//, '').startsWith(domainLower)) {
            position = r.position ?? i + 1;
            rankingUrl = r.url;
            break;
          }
        }
        const keywordRec = await prisma.keyword.upsert({
          where: { orgId_keyword: { orgId, keyword: kw } },
          create: { orgId, keyword: kw },
          update: { lastPosition: position, lastCheckedAt: new Date() }
        });
        await prisma.rankSnapshot.create({
          data: {
            orgId,
            keywordId: keywordRec.id,
            position,
            url: rankingUrl,
            region,
            topResults: webResults.slice(0, 5).map((r, i) => ({ title: r.title, url: r.url, position: r.position ?? i + 1 }))
          }
        });
        result.rankings.push({ keyword: kw, position, url: rankingUrl });
      } catch (e) {
        result.rankings.push({ keyword: kw, error: e.message });
      }
    }

    // Step 2: firecrawl.crawl competitors
    for (const comp of competitors.slice(0, 5)) {
      try {
        const crawlUrl = comp.startsWith('http') ? comp : `https://${comp}`;
        const crawlRes = await firecrawl.crawl(crawlUrl, { limit: 20, formats: ['markdown', 'links'] });
        const crawlId = crawlRes.id || crawlRes.data?.id;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await firecrawl.getCrawlStatus(crawlId);
          if (status.status === 'completed' || status.data?.status === 'completed') {
            break;
          }
        }
        const competitorRec = await prisma.competitor.upsert({
          where: { orgId_domain: { orgId, domain: comp } },
          create: { orgId, domain: comp, lastCrawledAt: new Date(), pageCount: 20 },
          update: { lastCrawledAt: new Date(), pageCount: 20 }
        });
        await prisma.competitorInsight.create({
          data: { competitorId: competitorRec.id, insightType: 'content_gap', data: { crawled: true } }
        });
        result.competitorInsights.push({ domain: comp, status: 'crawled' });
      } catch (e) {
        result.competitorInsights.push({ domain: comp, error: e.message });
      }
    }

    // Step 3: claude.analyzeJSON(STRATEGIC_BRIEF)
    const briefInput = JSON.stringify({
      domain,
      keywordData: result.rankings.map((r) => ({ keyword: r.keyword, position: r.position })),
      competitorData: result.competitorInsights
    });
    const strategicBrief = await claude.analyzeJSON(claude.PROMPTS.STRATEGIC_BRIEF, briefInput);
    result.strategicBrief = strategicBrief;

    // Step 4: claude.analyze(CONTENT_GENERATE) for top opportunity
    const topOpp = strategicBrief.topOpportunities?.[0] || strategicBrief.quickWins?.[0];
    const keywordForContent = topOpp?.keyword || keywords[0] || 'SEO strategy';
    const searchRes = await firecrawl.search(keywordForContent, { limit: 3, scrapeOptions: { formats: ['markdown'] } });
    const contentContext = (searchRes.data?.web || [])
      .map((r) => `${r.title}\n${(r.markdown || r.description || '').slice(0, 300)}`)
      .join('\n\n');
    const content = await claude.analyze(
      claude.PROMPTS.CONTENT_GENERATE,
      `Keyword: ${keywordForContent}\nCompetitor content:\n${contentContext}`,
      { maxTokens: 4096 }
    );
    const title = content.split('\n')[0]?.replace(/^#+\s*/, '') || `Content for ${keywordForContent}`;
    const draft = await prisma.blogDraft.create({
      data: {
        orgId,
        title,
        targetKeyword: keywordForContent,
        content,
        segment: 'general',
        wordCount: content.split(/\s+/).filter(Boolean).length,
        status: 'DRAFT'
      }
    });
    result.blogDraft = { id: draft.id, title, targetKeyword: keywordForContent };

    await prisma.scrapeRun.update({
      where: { id: scrapeRunId },
      data: { status: 'COMPLETED', result, completedAt: new Date() }
    });

    await deliverWebhook(scrapeRun.orgId, 'pipeline.completed', {
      jobId: scrapeRunId,
      status: 'completed',
      result: { rankings: result.rankings.length, strategicBrief: !!result.strategicBrief, blogDraft: result.blogDraft }
    });
  } catch (err) {
    await prisma.scrapeRun.update({
      where: { id: scrapeRunId },
      data: { status: 'FAILED', error: err.message, completedAt: new Date() }
    });
    await deliverWebhook(scrapeRun.orgId, 'pipeline.completed', {
      jobId: scrapeRunId,
      status: 'failed',
      error: err.message
    });
    throw err;
  }
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => processPipelineJob(job),
  { connection: redis }
);

worker.on('completed', (job) => console.log(`Pipeline job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Pipeline job ${job?.id} failed:`, err.message));

module.exports = { worker, QUEUE_NAME };
