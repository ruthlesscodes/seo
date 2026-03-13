/**
 * SEO Agent Team — Phased Multi-Agent Architecture
 *
 * Unlike deerflow.js (parallel scanners), this implements a real agent team
 * where each phase builds on the previous one's output.
 *
 * Phase 1 (Parallel — independent scans):
 *   ├── TechnicalAgent    — crawl site, find issues (thin pages, broken links, missing meta)
 *   ├── KeywordAgent      — search rankings, discover opportunities
 *   ├── CompetitorAgent   — scrape & analyze competitor content
 *   └── RankTrackerAgent  — current SERP positions + GSC data
 *
 * Phase 2 (Sequential — reads Phase 1):
 *   └── ContentManager    — builds content briefs using gaps found in Phase 1
 *
 * Phase 3 (Sequential — reads Phase 2):
 *   └── ContentWriter     — scrapes competitor pages for target keywords, writes drafts
 *
 * Phase 4 (Sequential — reads Phase 1 + 3):
 *   └── LinkBuilder       — finds link prospects from competitor backlink patterns
 *
 * Phase 5 (Synthesis — reads everything):
 *   └── TeamLead          — scores all results, produces ranked action plan
 *
 * Key difference from deerflow.js:
 *   - Agents pass real data forward (not just collect in parallel)
 *   - ContentWriter scrapes the exact competitor URLs that rank for gap keywords
 *   - LinkBuilder uses competitor data + new content URLs
 *   - TeamLead sees the full chain and produces a coherent plan
 */

const { prisma } = require('../utils/prisma');
const firecrawl = require('./firecrawl');
const claude = require('./claude');
const { deliverWebhook } = require('../utils/webhookDelivery');

// ============================================
// PHASE 1 AGENTS — Independent, run in parallel
// ============================================

async function technicalAgent(siteUrl, domain) {
  try {
    // Crawl site for structural issues
    const crawlRes = await firecrawl.crawl(siteUrl, {
      limit: 30,
      maxDepth: 3,
      formats: ['markdown', 'links'],
    });

    let pages = [];
    const crawlId = crawlRes.id || crawlRes.data?.id;
    if (crawlId) {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await firecrawl.getCrawlStatus(crawlId);
        const s = status.status || status.data?.status;
        if (s === 'completed') {
          const raw = status.data?.data || status.data || status.completed || [];
          pages = raw.map((p) => ({
            url: p.metadata?.url || p.url,
            title: p.metadata?.title || '',
            markdown: p.markdown || '',
            links: p.links || [],
            statusCode: p.metadata?.statusCode,
          }));
          break;
        }
        if (s === 'failed') break;
      }
    }

    // Analyze crawl data with Claude
    const crawlSummary = pages.map((p) => ({
      url: p.url,
      title: p.title,
      wordCount: (p.markdown || '').split(/\s+/).length,
      linkCount: p.links?.length || 0,
      statusCode: p.statusCode,
      hasH1: /^#\s/m.test(p.markdown),
      hasMeta: !!p.title,
    }));

    const analysis = await claude.analyzeJSON(
      claude.PROMPTS.TECHNICAL_AUDIT,
      JSON.stringify({
        domain,
        pagesAudited: crawlSummary.length,
        pages: crawlSummary,
      })
    );

    // Identify thin pages (< 300 words) for Content Manager
    const thinPages = pages
      .filter((p) => (p.markdown || '').split(/\s+/).length < 300)
      .map((p) => ({ url: p.url, title: p.title, wordCount: (p.markdown || '').split(/\s+/).length }));

    return {
      agent: 'technical',
      success: true,
      data: {
        ...analysis,
        pagesAudited: pages.length,
        thinPages,
        allPages: crawlSummary,
      },
    };
  } catch (err) {
    return { agent: 'technical', success: false, error: err.message };
  }
}

async function keywordAgent(domain, keywords) {
  try {
    const results = await Promise.allSettled(
      keywords.map(async (kw) => {
        const keyword = typeof kw === 'string' ? kw : kw.keyword;
        const res = await firecrawl.search(keyword, { limit: 10, country: 'US' });
        const webResults = res.data?.web || res.data?.results || res.data || [];
        const cleanDomain = domain.replace(/^www\./, '').toLowerCase();
        const ourResult = webResults.find((r) =>
          (r.url || '').toLowerCase().includes(cleanDomain)
        );
        const topCompetitors = webResults
          .filter((r) => !(r.url || '').toLowerCase().includes(cleanDomain))
          .slice(0, 5)
          .map((r) => ({ url: r.url, title: r.title, position: r.position }));

        return {
          keyword,
          segment: kw.segment || 'core',
          isRanking: !!ourResult,
          ourPosition: ourResult?.position ?? null,
          ourUrl: ourResult?.url || null,
          topCompetitors,
          opportunity: !ourResult ? 'HIGH' : ourResult.position > 5 ? 'MEDIUM' : 'LOW',
        };
      })
    );

    const data = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { keyword: '?', isRanking: false, opportunity: 'UNKNOWN' }
    );

    return {
      agent: 'keyword',
      success: true,
      data: {
        keywords: data,
        ranking: data.filter((k) => k.isRanking).length,
        notRanking: data.filter((k) => !k.isRanking).length,
        highOpportunity: data.filter((k) => k.opportunity === 'HIGH'),
      },
    };
  } catch (err) {
    return { agent: 'keyword', success: false, error: err.message };
  }
}

async function competitorAgent(domain, competitors) {
  if (!competitors || competitors.length === 0) {
    return { agent: 'competitor', success: true, data: { competitors: [], note: 'No competitors configured' } };
  }

  try {
    const results = [];
    for (const comp of competitors.slice(0, 5)) {
      const compDomain = typeof comp === 'string' ? comp : comp.domain;
      const compUrl = compDomain.startsWith('http') ? compDomain : `https://${compDomain}`;
      try {
        // Map competitor site first (cheap — 1 credit)
        const mapRes = await firecrawl.map(compUrl, { limit: 200 });
        const urls = mapRes.links || mapRes.data?.links || [];

        // Scrape top pages
        const topUrls = urls.slice(0, 10);
        const scrapeResults = [];
        for (const url of topUrls) {
          try {
            const page = await firecrawl.scrape(url, { formats: ['markdown'] });
            scrapeResults.push({
              url,
              title: page.data?.metadata?.title || '',
              wordCount: (page.data?.markdown || '').split(/\s+/).length,
              contentSnippet: (page.data?.markdown || '').slice(0, 500),
            });
          } catch {
            // Skip failed scrapes
          }
        }

        results.push({
          domain: compDomain,
          success: true,
          totalUrls: urls.length,
          pagesScraped: scrapeResults.length,
          pages: scrapeResults,
          avgWordCount: scrapeResults.length
            ? Math.round(scrapeResults.reduce((a, p) => a + p.wordCount, 0) / scrapeResults.length)
            : 0,
        });
      } catch (e) {
        results.push({ domain: compDomain, success: false, error: e.message });
      }
    }

    return { agent: 'competitor', success: true, data: { competitors: results } };
  } catch (err) {
    return { agent: 'competitor', success: false, error: err.message };
  }
}

async function rankTrackerAgent(org) {
  try {
    // Try GSC data first
    let gscData = null;
    try {
      const gscToken = await prisma.orgGSCToken?.findUnique?.({
        where: { orgId: org.id },
      }).catch(() => null);

      if (gscToken) {
        const { getTopKeywords, getTopPages, detectRankingDrops } = require('./searchConsole');
        const siteUrl = org.domain.startsWith('http') ? org.domain : `https://${org.domain}`;
        const tokens = { accessToken: gscToken.accessToken, refreshToken: gscToken.refreshToken };

        const [topKeywords, topPages, drops] = await Promise.allSettled([
          getTopKeywords(tokens, siteUrl, 50),
          getTopPages(tokens, siteUrl, 20),
          detectRankingDrops(tokens, siteUrl),
        ]);

        gscData = {
          topKeywords: topKeywords.status === 'fulfilled' ? topKeywords.value : [],
          topPages: topPages.status === 'fulfilled' ? topPages.value : [],
          rankingDrops: drops.status === 'fulfilled' ? drops.value : [],
        };
      }
    } catch {
      // GSC not available
    }

    // Check recent rank snapshots from DB
    const recentSnapshots = await prisma.rankSnapshot?.findMany?.({
      where: {
        keyword: { orgId: org.id },
        checkedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      include: { keyword: true },
      orderBy: { checkedAt: 'desc' },
      take: 100,
    }).catch(() => []);

    return {
      agent: 'rankTracker',
      success: true,
      data: {
        gsc: gscData,
        recentSnapshots: (recentSnapshots || []).map((s) => ({
          keyword: s.keyword?.keyword,
          position: s.position,
          url: s.url,
          checkedAt: s.checkedAt,
        })),
        gscConnected: !!gscData,
      },
    };
  } catch (err) {
    return { agent: 'rankTracker', success: false, error: err.message };
  }
}

// ============================================
// PHASE 2 — Content Manager (reads Phase 1)
// ============================================

async function contentManagerAgent(phase1Results) {
  try {
    const context = {
      technicalIssues: phase1Results.technical?.data?.thinPages || [],
      keywordGaps: phase1Results.keyword?.data?.highOpportunity || [],
      competitorContent: (phase1Results.competitor?.data?.competitors || [])
        .filter((c) => c.success)
        .map((c) => ({
          domain: c.domain,
          avgWordCount: c.avgWordCount,
          topPages: (c.pages || []).slice(0, 3).map((p) => ({ url: p.url, title: p.title, wordCount: p.wordCount })),
        })),
      rankingDrops: phase1Results.rankTracker?.data?.gsc?.rankingDrops || [],
    };

    const briefs = await claude.analyzeJSON(
      `You are a content strategist on an SEO team. You have just received data from 4 specialist agents:
- Technical agent found thin/weak pages
- Keyword agent found gap opportunities (keywords we don't rank for)
- Competitor agent scraped competitor sites
- Rank tracker found ranking drops

Your job: produce content briefs that address the MOST impactful opportunities.
Prioritize: 1) Fixing thin pages that already exist, 2) New content for high-opportunity keywords, 3) Refreshing pages with ranking drops.

Return JSON: {
  briefs: [{
    priority: 1-5,
    type: "refresh" | "new" | "expand",
    targetKeyword: string,
    targetUrl: string | null,
    title: string,
    competitorUrlsToScrape: [string],
    reasoning: string,
    targetWordCount: number
  }],
  summary: string
}`,
      JSON.stringify(context)
    );

    return {
      agent: 'contentManager',
      success: true,
      data: briefs,
    };
  } catch (err) {
    return { agent: 'contentManager', success: false, error: err.message };
  }
}

// ============================================
// PHASE 3 — Content Writer (reads Phase 2 + competitor data)
// ============================================

async function contentWriterAgent(contentBriefs, competitorData) {
  try {
    const briefs = (contentBriefs?.data?.briefs || []).slice(0, 3); // Top 3 briefs
    const drafts = [];

    for (const brief of briefs) {
      // Scrape the specific competitor URLs the Content Manager identified
      let competitorContent = '';
      for (const url of (brief.competitorUrlsToScrape || []).slice(0, 3)) {
        try {
          const page = await firecrawl.scrape(url, { formats: ['markdown'] });
          competitorContent += `\n\n--- Competitor: ${url} ---\n${(page.data?.markdown || '').slice(0, 1500)}`;
        } catch {
          // Skip failed scrapes
        }
      }

      try {
        const content = await claude.analyze(
          claude.PROMPTS.CONTENT_GENERATE,
          `Brief: ${JSON.stringify(brief)}
Target keyword: ${brief.targetKeyword}
Type: ${brief.type} (${brief.type === 'refresh' ? 'Update existing content at ' + brief.targetUrl : 'Write new content'})
Target word count: ${brief.targetWordCount || 1500}

Competitor content for reference (outperform these):
${competitorContent || 'No competitor content available'}`,
          { maxTokens: 4096 }
        );

        drafts.push({
          success: true,
          priority: brief.priority,
          type: brief.type,
          targetKeyword: brief.targetKeyword,
          targetUrl: brief.targetUrl,
          title: brief.title,
          content,
          wordCount: content.split(/\s+/).length,
        });
      } catch (e) {
        drafts.push({
          success: false,
          targetKeyword: brief.targetKeyword,
          error: e.message,
        });
      }

      // Rate limit between generations
      await new Promise((r) => setTimeout(r, 2000));
    }

    return {
      agent: 'contentWriter',
      success: true,
      data: { drafts, totalGenerated: drafts.filter((d) => d.success).length },
    };
  } catch (err) {
    return { agent: 'contentWriter', success: false, error: err.message };
  }
}

// ============================================
// PHASE 4 — Link Builder (reads Phase 1 + 3)
// ============================================

async function linkBuilderAgent(phase1Results, contentDrafts) {
  try {
    const competitorDomains = (phase1Results.competitor?.data?.competitors || [])
      .filter((c) => c.success)
      .map((c) => c.domain);

    const newContentKeywords = (contentDrafts?.data?.drafts || [])
      .filter((d) => d.success)
      .map((d) => d.targetKeyword);

    // Search for link prospects using target keywords
    const prospects = [];
    for (const keyword of newContentKeywords.slice(0, 5)) {
      try {
        const res = await firecrawl.search(`${keyword} resources links`, { limit: 10 });
        const results = res.data?.web || res.data?.results || res.data || [];
        for (const r of results) {
          const url = (r.url || '').toLowerCase();
          // Skip if it's a competitor or our own domain
          if (!competitorDomains.some((d) => url.includes(d.toLowerCase()))) {
            prospects.push({
              url: r.url,
              title: r.title,
              keyword,
              type: 'resource_page',
            });
          }
        }
      } catch {
        // Skip failed searches
      }
    }

    // Let Claude analyze and prioritize
    const analysis = await claude.analyzeJSON(
      `You are a link building strategist. Given link prospects found by searching for resource pages related to our target keywords, prioritize them. Return JSON: {
  prospects: [{ url, title, keyword, outreachPriority: "high"|"medium"|"low", reason, suggestedAngle }],
  outreachTemplateIdeas: [string],
  summary: string
}`,
      JSON.stringify({ prospects: prospects.slice(0, 30), competitorDomains, newContentKeywords })
    );

    return {
      agent: 'linkBuilder',
      success: true,
      data: analysis,
    };
  } catch (err) {
    return { agent: 'linkBuilder', success: false, error: err.message };
  }
}

// ============================================
// PHASE 5 — Team Lead (synthesis of everything)
// ============================================

async function teamLeadAgent(org, allResults) {
  try {
    const context = {
      domain: org.domain,
      plan: org.plan,
      technical: {
        score: allResults.technical?.data?.score,
        criticalIssues: allResults.technical?.data?.summary?.critical || 0,
        thinPages: (allResults.technical?.data?.thinPages || []).length,
      },
      keywords: {
        ranking: allResults.keyword?.data?.ranking || 0,
        notRanking: allResults.keyword?.data?.notRanking || 0,
        highOpportunity: (allResults.keyword?.data?.highOpportunity || []).length,
      },
      competitors: (allResults.competitor?.data?.competitors || []).map((c) => ({
        domain: c.domain,
        avgWordCount: c.avgWordCount,
        totalUrls: c.totalUrls,
      })),
      rankTracker: {
        gscConnected: allResults.rankTracker?.data?.gscConnected,
        rankingDrops: (allResults.rankTracker?.data?.gsc?.rankingDrops || []).length,
      },
      contentBriefs: (allResults.contentManager?.data?.briefs || []).length,
      contentDrafts: allResults.contentWriter?.data?.totalGenerated || 0,
      linkProspects: (allResults.linkBuilder?.data?.prospects || []).length,
    };

    const plan = await claude.analyzeJSON(
      `You are the SEO Team Lead. Your 7 specialist agents have completed their work. Synthesize ALL their findings into one prioritized action plan.

Score the overall SEO health and produce a week-by-week plan. Be specific — reference exact URLs, keywords, and issues from the data.

Return JSON: {
  overallHealthScore: 0-100,
  executiveSummary: string,
  priorityActions: [{
    rank: number,
    category: "technical" | "content" | "keywords" | "links" | "tracking",
    title: string,
    impact: "critical" | "high" | "medium" | "low",
    effort: "quick-win" | "moderate" | "major",
    description: string,
    steps: [string]
  }],
  weeklyPlan: [{
    week: number,
    focus: string,
    tasks: [string]
  }],
  kpis: [{
    metric: string,
    current: string,
    target: string,
    timeframe: string
  }],
  estimatedTrafficImpact: string,
  nextAuditRecommendation: string
}`,
      JSON.stringify(context)
    );

    return {
      agent: 'teamLead',
      success: true,
      data: plan,
    };
  } catch (err) {
    return { agent: 'teamLead', success: false, error: err.message };
  }
}

// ============================================
// ORCHESTRATOR — Runs the full team in phases
// ============================================

async function runTeamAudit(orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { competitors: true, keywords: true },
  });

  if (!org) throw new Error(`Org ${orgId} not found`);

  const siteUrl = org.domain.startsWith('http') ? org.domain : `https://${org.domain}`;
  const auditRunId = `team_${Date.now()}_${orgId.slice(-6)}`;
  const keywords = (org.keywords || []).map((k) => ({ keyword: k.keyword, segment: k.segment }));

  console.log(`[SEO Team] Starting audit ${auditRunId} for ${org.domain}`);
  console.log(`[SEO Team] Phase 1: Running 4 independent agents in parallel...`);

  // ── Phase 1: Parallel scans ──
  const [technicalResult, keywordResult, competitorResult, rankTrackerResult] = await Promise.allSettled([
    technicalAgent(siteUrl, org.domain),
    keywordAgent(org.domain, keywords.length ? keywords : [{ keyword: org.domain.replace(/\.\w+$/, '') }]),
    competitorAgent(org.domain, org.competitors),
    rankTrackerAgent(org),
  ]);

  const phase1 = {
    technical: technicalResult.status === 'fulfilled' ? technicalResult.value : { agent: 'technical', success: false, error: technicalResult.reason?.message },
    keyword: keywordResult.status === 'fulfilled' ? keywordResult.value : { agent: 'keyword', success: false, error: keywordResult.reason?.message },
    competitor: competitorResult.status === 'fulfilled' ? competitorResult.value : { agent: 'competitor', success: false, error: competitorResult.reason?.message },
    rankTracker: rankTrackerResult.status === 'fulfilled' ? rankTrackerResult.value : { agent: 'rankTracker', success: false, error: rankTrackerResult.reason?.message },
  };

  console.log(`[SEO Team] Phase 1 complete. Technical: ${phase1.technical.success}, Keywords: ${phase1.keyword.success}, Competitors: ${phase1.competitor.success}, RankTracker: ${phase1.rankTracker.success}`);

  // ── Phase 2: Content Manager reads Phase 1 ──
  console.log(`[SEO Team] Phase 2: Content Manager analyzing gaps...`);
  const contentManagerResult = await contentManagerAgent(phase1).catch((err) => ({
    agent: 'contentManager', success: false, error: err.message,
  }));

  // ── Phase 3: Content Writer reads Phase 2 ──
  console.log(`[SEO Team] Phase 3: Content Writer drafting content...`);
  const contentWriterResult = await contentWriterAgent(contentManagerResult, phase1.competitor).catch((err) => ({
    agent: 'contentWriter', success: false, error: err.message,
  }));

  // ── Phase 4: Link Builder reads Phase 1 + 3 ──
  console.log(`[SEO Team] Phase 4: Link Builder prospecting...`);
  const linkBuilderResult = await linkBuilderAgent(phase1, contentWriterResult).catch((err) => ({
    agent: 'linkBuilder', success: false, error: err.message,
  }));

  // ── Phase 5: Team Lead synthesizes everything ──
  console.log(`[SEO Team] Phase 5: Team Lead synthesizing action plan...`);
  const allResults = {
    ...phase1,
    contentManager: contentManagerResult,
    contentWriter: contentWriterResult,
    linkBuilder: linkBuilderResult,
  };

  const teamLeadResult = await teamLeadAgent(org, allResults).catch((err) => ({
    agent: 'teamLead', success: false, error: err.message,
  }));

  allResults.teamLead = teamLeadResult;

  // ── Persist results ──
  const leadData = teamLeadResult?.data;

  await prisma.auditRun.create({
    data: {
      orgId,
      domain: org.domain,
      status: 'COMPLETED',
      totalPages: phase1.technical?.data?.pagesAudited || 1,
      issuesFound: (phase1.technical?.data?.summary?.critical || 0) + (phase1.technical?.data?.summary?.warnings || 0),
      summary: {
        overallHealthScore: leadData?.overallHealthScore,
        executiveSummary: leadData?.executiveSummary,
        technicalScore: phase1.technical?.data?.score,
        keywordsRanking: phase1.keyword?.data?.ranking,
        keywordsNotRanking: phase1.keyword?.data?.notRanking,
        contentBriefsGenerated: (contentManagerResult?.data?.briefs || []).length,
        contentDraftsGenerated: contentWriterResult?.data?.totalGenerated || 0,
        linkProspectsFound: (linkBuilderResult?.data?.prospects || []).length,
        agentAuditId: auditRunId,
        agentType: 'seoTeam',
      },
      completedAt: new Date(),
    },
  });

  await deliverWebhook(orgId, 'audit.completed', {
    auditId: auditRunId,
    domain: org.domain,
    agentType: 'seoTeam',
    overallScore: leadData?.overallHealthScore,
    priorityActionCount: (leadData?.priorityActions || []).length,
    contentDraftsGenerated: contentWriterResult?.data?.totalGenerated || 0,
    completedAt: new Date().toISOString(),
  }).catch(() => {});

  console.log(`[SEO Team] Audit ${auditRunId} complete. Score: ${leadData?.overallHealthScore || 'N/A'}`);

  return {
    auditRunId,
    orgId,
    domain: org.domain,
    overallScore: leadData?.overallHealthScore,
    executiveSummary: leadData?.executiveSummary,
    priorityActions: leadData?.priorityActions || [],
    weeklyPlan: leadData?.weeklyPlan || [],
    kpis: leadData?.kpis || [],
    contentDrafts: contentWriterResult?.data?.drafts || [],
    linkProspects: linkBuilderResult?.data?.prospects || [],
    agentResults: allResults,
  };
}

async function runDailyTeamAudits() {
  const BATCH_SIZE = 2; // Lower than deerflow — team audits are heavier

  const orgs = await prisma.organization.findMany({
    where: { plan: { not: 'FREE' } },
    select: { id: true, domain: true, plan: true },
  });

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < orgs.length; i += BATCH_SIZE) {
    const batch = orgs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((org) => runTeamAudit(org.id)));

    for (const [j, res] of batchResults.entries()) {
      if (res.status === 'fulfilled') {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ orgId: batch[j].id, domain: batch[j].domain, error: res.reason?.message });
      }
    }

    if (i + BATCH_SIZE < orgs.length) {
      await new Promise((r) => setTimeout(r, 10000)); // Longer cooldown between batches
    }
  }

  return results;
}

module.exports = {
  runTeamAudit,
  runDailyTeamAudits,
  // Individual agents exported for testing / on-demand use
  technicalAgent,
  keywordAgent,
  competitorAgent,
  rankTrackerAgent,
  contentManagerAgent,
  contentWriterAgent,
  linkBuilderAgent,
  teamLeadAgent,
};
