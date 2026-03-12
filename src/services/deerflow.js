/**
 * DeerFlow Agent Orchestrator
 *
 * Connects your existing SEO API to DeerFlow's multi-agent runtime.
 * One Lead Agent per client → spawns 5 specialised sub-agents in parallel.
 *
 * Architecture:
 *   Lead Agent (orchestrates per org)
 *     ├── LighthouseAgent    — Core Web Vitals + page scores
 *     ├── TechnicalSEOAgent  — crawl + meta/schema/links
 *     ├── GSCAgent           — Search Console data + ranking drops
 *     ├── CompetitorAgent    — competitor content + ranking shifts
 *     └── RecommendationAgent — synthesises all → prioritised fixes
 *
 * DeerFlow runs at DEERFLOW_URL (self-hosted on Railway / K8s).
 */

const { prisma } = require('../utils/prisma');
const { deliverWebhook } = require('../utils/webhookDelivery');

const DEERFLOW_URL = process.env.DEERFLOW_URL || 'http://localhost:2026';
const DEERFLOW_GATEWAY = process.env.DEERFLOW_GATEWAY_URL || DEERFLOW_URL;

const DEERFLOW_API_KEY = process.env.DEERFLOW_API_KEY;

function deerflowHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (DEERFLOW_API_KEY) {
    headers.Authorization = `Bearer ${DEERFLOW_API_KEY}`;
  }
  return headers;
}

async function deerflowRequest(endpoint, body) {
  const res = await fetch(`${DEERFLOW_GATEWAY}${endpoint}`, {
    method: 'POST',
    headers: deerflowHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeerFlow error ${res.status}: ${text}`);
  }

  return res.json();
}

async function runLighthouseAgent(siteUrl) {
  try {
    const result = await deerflowRequest('/api/langgraph/invoke', {
      agent: 'lighthouse-auditor',
      input: {
        url: siteUrl,
        skill: 'lighthouse-audit',
        outputFormat: 'json',
        prompt: `Run a full Lighthouse audit on ${siteUrl}. Return JSON with: { scores: { performance, seo, accessibility, bestPractices }, cwv: { lcp, cls, fcp, ttfb, tbt }, seoIssues: [], opportunities: [] }`,
      },
    });
    return { agent: 'lighthouse', success: true, data: result.output };
  } catch (err) {
    try {
      const { runLighthouseAudit } = require('./lighthouse');
      const local = await runLighthouseAudit(siteUrl, { mobile: true });
      return { agent: 'lighthouse', success: true, data: local, usedFallback: true };
    } catch (fallbackErr) {
      return { agent: 'lighthouse', success: false, error: err.message };
    }
  }
}

async function runTechnicalSEOAgent(siteUrl, domain) {
  try {
    const result = await deerflowRequest('/api/langgraph/invoke', {
      agent: 'technical-seo-scanner',
      input: {
        url: siteUrl,
        domain,
        skill: 'technical-seo-audit',
        prompt: `Crawl ${siteUrl} and perform a full technical SEO audit. Return JSON: { issues: [{ type, severity, url, description, recommendation }], summary: { critical, warnings, info } }`,
      },
    });
    return { agent: 'technical', success: true, data: result.output };
  } catch (err) {
    return { agent: 'technical', success: false, error: err.message };
  }
}

async function runGSCAgent(org) {
  try {
    const gscToken = await prisma.orgGSCToken?.findUnique?.({
      where: { orgId: org.id },
    }).catch(() => null);

    if (!gscToken) {
      return { agent: 'gsc', success: true, data: null, note: 'GSC not connected' };
    }

    const { getTopKeywords, getTopPages, detectRankingDrops } = require('./searchConsole');
    const siteUrl = org.domain.startsWith('http') ? org.domain : `https://${org.domain}`;
    const tokens = { accessToken: gscToken.accessToken, refreshToken: gscToken.refreshToken };

    const [topKeywords, topPages, drops] = await Promise.allSettled([
      getTopKeywords(tokens, siteUrl, 50),
      getTopPages(tokens, siteUrl, 20),
      detectRankingDrops(tokens, siteUrl),
    ]);

    return {
      agent: 'gsc',
      success: true,
      data: {
        topKeywords: topKeywords.status === 'fulfilled' ? topKeywords.value : [],
        topPages: topPages.status === 'fulfilled' ? topPages.value : [],
        rankingDrops: drops.status === 'fulfilled' ? drops.value : [],
      },
    };
  } catch (err) {
    return { agent: 'gsc', success: false, error: err.message };
  }
}

async function runCompetitorAgent(org, competitors) {
  if (!competitors || competitors.length === 0) {
    return { agent: 'competitor', success: true, data: [], note: 'No competitors configured' };
  }

  try {
    const result = await deerflowRequest('/api/langgraph/invoke', {
      agent: 'competitor-tracker',
      input: {
        competitors: competitors.slice(0, 5).map((c) => c.domain),
        orgDomain: org.domain,
        skill: 'competitor-analysis',
        prompt: `Analyse these competitor sites vs ${org.domain}. Return JSON: { insights: [{ domain, type, description, impact, data }] }`,
      },
    });
    return { agent: 'competitor', success: true, data: result.output };
  } catch (err) {
    return { agent: 'competitor', success: false, error: err.message };
  }
}

async function runRecommendationAgent(org, allAgentResults) {
  const { analyzeJSON } = require('./claude');

  const context = JSON.stringify({
    domain: org.domain,
    plan: org.plan,
    lighthouse: allAgentResults.lighthouse?.data,
    technical: allAgentResults.technical?.data,
    gsc: allAgentResults.gsc?.data,
    competitors: allAgentResults.competitor?.data,
  });

  const recommendations = await analyzeJSON(
    `You are an expert SEO strategist. Given audit data, generate a prioritised action plan. Return JSON: {
  overallHealthScore: 0-100,
  priorityFixes: [{ rank, category, title, impact, effort, description, steps }],
  weeklyGoals: [],
  estimatedTrafficImpact: string
}`,
    context
  );

  return { agent: 'recommendations', success: true, data: recommendations };
}

async function runOrgAudit(orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { competitors: true },
  });

  if (!org) throw new Error(`Org ${orgId} not found`);

  const siteUrl = org.domain.startsWith('http') ? org.domain : `https://${org.domain}`;
  const auditRunId = `agent_${Date.now()}_${orgId.slice(-6)}`;

  const [lighthouseResult, technicalResult, gscResult, competitorResult] = await Promise.allSettled([
    runLighthouseAgent(siteUrl),
    runTechnicalSEOAgent(siteUrl, org.domain),
    runGSCAgent(org),
    runCompetitorAgent(org, org.competitors),
  ]);

  const agentResults = {
    lighthouse: lighthouseResult.status === 'fulfilled' ? lighthouseResult.value : { agent: 'lighthouse', success: false, error: lighthouseResult.reason?.message },
    technical: technicalResult.status === 'fulfilled' ? technicalResult.value : { agent: 'technical', success: false, error: technicalResult.reason?.message },
    gsc: gscResult.status === 'fulfilled' ? gscResult.value : { agent: 'gsc', success: false, error: gscResult.reason?.message },
    competitor: competitorResult.status === 'fulfilled' ? competitorResult.value : { agent: 'competitor', success: false, error: competitorResult.reason?.message },
  };

  const recommendationResult = await runRecommendationAgent(org, agentResults).catch((err) => ({
    agent: 'recommendations',
    success: false,
    error: err.message,
  }));

  agentResults.recommendations = recommendationResult;

  const lighthouseData = agentResults.lighthouse?.data;
  const recData = agentResults.recommendations?.data;

  await prisma.auditRun.create({
    data: {
      orgId,
      domain: org.domain,
      status: 'COMPLETED',
      totalPages: 1,
      issuesFound: (agentResults.technical?.data?.summary?.critical || 0) + (agentResults.technical?.data?.summary?.warnings || 0),
      summary: {
        critical: agentResults.technical?.data?.summary?.critical || 0,
        warnings: agentResults.technical?.data?.summary?.warnings || 0,
        info: agentResults.technical?.data?.summary?.info || 0,
        lighthousePerformance: lighthouseData?.scores?.performance,
        lighthouseSEO: lighthouseData?.scores?.seo,
        overallHealthScore: recData?.overallHealthScore,
        agentAuditId: auditRunId,
      },
      completedAt: new Date(),
    },
  });

  await prisma.lighthouseReport?.create?.({
    data: {
      orgId,
      url: siteUrl,
      performanceScore: lighthouseData?.scores?.performance,
      seoScore: lighthouseData?.scores?.seo,
      accessibilityScore: lighthouseData?.scores?.accessibility,
      bestPracticesScore: lighthouseData?.scores?.bestPractices,
      lcpMs: lighthouseData?.cwv?.lcp ? Math.round(lighthouseData.cwv.lcp) : null,
      clsScore: lighthouseData?.cwv?.cls,
      fcpMs: lighthouseData?.cwv?.fcp ? Math.round(lighthouseData.cwv.fcp) : null,
      ttfbMs: lighthouseData?.cwv?.ttfb ? Math.round(lighthouseData.cwv.ttfb) : null,
      rawData: lighthouseData,
    },
  }).catch(() => {});

  await deliverWebhook(orgId, 'audit.completed', {
    auditId: auditRunId,
    domain: org.domain,
    overallScore: recData?.overallHealthScore,
    lighthousePerformance: lighthouseData?.scores?.performance,
    lighthouseSEO: lighthouseData?.scores?.seo,
    priorityFixCount: recData?.priorityFixes?.length || 0,
    completedAt: new Date().toISOString(),
  }).catch(() => {});

  return {
    auditRunId,
    orgId,
    domain: org.domain,
    agentResults,
    overallScore: recData?.overallHealthScore,
    priorityFixes: recData?.priorityFixes || [],
    weeklyGoals: recData?.weeklyGoals || [],
  };
}

async function runDailyAuditsForAllOrgs() {
  const BATCH_SIZE = 3;

  const orgs = await prisma.organization.findMany({
    where: { plan: { not: 'FREE' } },
    select: { id: true, domain: true, plan: true },
  });

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < orgs.length; i += BATCH_SIZE) {
    const batch = orgs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((org) => runOrgAudit(org.id)));

    for (const [j, res] of batchResults.entries()) {
      if (res.status === 'fulfilled') {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ orgId: batch[j].id, domain: batch[j].domain, error: res.reason?.message });
      }
    }

    if (i + BATCH_SIZE < orgs.length) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return results;
}

module.exports = {
  runOrgAudit,
  runDailyAuditsForAllOrgs,
  runLighthouseAgent,
  runTechnicalSEOAgent,
  runGSCAgent,
  runCompetitorAgent,
  runRecommendationAgent,
};
