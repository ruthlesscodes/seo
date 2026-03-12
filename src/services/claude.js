/**
 * Claude Analysis Service
 *
 * Handles all AI analysis: keyword clustering, content generation,
 * SEO auditing, GEO scoring, gap analysis, strategic briefs.
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

async function analyze(systemPrompt, userPrompt, options = {}) {
  const { maxTokens = 4096, temperature = 0.3 } = options;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  return response.content[0]?.text || '';
}

async function analyzeJSON(systemPrompt, userPrompt, options = {}) {
  const text = await analyze(
    systemPrompt + '\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble.',
    userPrompt,
    options
  );
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error(`Claude returned invalid JSON: ${text.substring(0, 200)}`);
  }
}

// ============================================
// SEO Analysis Prompts
// ============================================

const PROMPTS = {
  KEYWORD_CLUSTER: `You are an expert SEO strategist. Given a list of keywords, cluster them by search intent:
- INFORMATIONAL: seeking knowledge (how to, what is, guide)
- TRANSACTIONAL: ready to buy/sign up (best, buy, pricing, vs)
- NAVIGATIONAL: looking for specific site/page (brand name, login)
- COMMERCIAL: researching before buying (review, comparison)

Return JSON: { clusters: [{ intent, keywords: [], suggestedPillarTopic }] }`,

  CONTENT_BRIEF: `You are a content strategist. Generate a detailed content brief for an SEO blog post.
Return JSON: {
  title, metaDescription, targetWordCount,
  outline: [{ h2, h3s: [], keyPoints: [] }],
  secondaryKeywords: [], faqQuestions: [],
  internalLinkSuggestions: [], competitorAngles: []
}`,

  CONTENT_GENERATE: `You are an expert SEO content writer. Write a comprehensive, engaging blog post
that naturally incorporates the target keyword and related terms. Use proper heading hierarchy (H2, H3).
Include FAQ section at the end. Target 1500-2000 words. Write in a human, conversational tone.`,

  CONTENT_REFRESH: `You are an SEO content analyst. Given existing content and current SERP data,
recommend specific updates to improve rankings. Return JSON: {
  overallScore: 0-100, issues: [{ type, severity, description, fix }],
  sectionsToAdd: [], sectionsToRemove: [], keywordsToAdd: [],
  updatedMetaDescription, estimatedImpact
}`,

  GAP_ANALYSIS: `You are a competitive SEO analyst. Compare the client's content/keywords against
competitors and identify gaps. Return JSON: {
  gaps: [{ keyword, difficulty, opportunity_score, competitor_url, recommendation }],
  quickWins: [], longTermPlays: [], contentIdeas: []
}`,

  TECHNICAL_AUDIT: `You are a technical SEO expert. Analyze the extracted page data and identify issues.
Return JSON: {
  score: 0-100,
  issues: [{ type, severity: "critical"|"warning"|"info", description, recommendation }],
  summary: { critical: N, warnings: N, info: N }
}`,

  GEO_READABILITY: `You are an AI search optimization expert (GEO/AEO). Score how well this content
is structured for AI comprehension and citation. Return JSON: {
  score: 0-100,
  breakdown: {
    atomicClarity: 0-20, faqStructure: 0-15, schemaMarkup: 0-15,
    semanticClarity: 0-15, citationWorthiness: 0-15, entityAssociation: 0-10,
    headingHierarchy: 0-10
  },
  recommendations: [{ category, priority, description, implementation }]
}`,

  GEO_CITATION: `You are an AI search optimization strategist. Analyze how likely AI platforms
(ChatGPT, Claude, Perplexity, Google AI Overviews) are to cite this brand for relevant queries.
Return JSON: {
  citationLikelihood: 0-100,
  currentStrengths: [], weaknesses: [],
  keyQueries: [{ query, currentlyCited: bool, citedBrand, recommendation }],
  contentRecommendations: [], structuralRecommendations: []
}`,

  STRATEGIC_BRIEF: `You are a senior SEO strategist. Synthesize keyword data, competitor analysis,
and SERP landscape into an actionable strategic brief. Return JSON: {
  summary, topOpportunities: [], threats: [], quickWins: [],
  contentCalendar: [{ week, topic, keyword, type, priority }],
  technicalPriorities: [], estimatedTimeline
}`
};

module.exports = { analyze, analyzeJSON, PROMPTS };
