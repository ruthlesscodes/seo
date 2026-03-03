const { z } = require('zod');

// ============================================
// Common
// ============================================
const RegionCode = z.string().length(2).default('US');
const TbsFilter = z.enum(['qdr:h', 'qdr:d', 'qdr:w', 'qdr:m', 'qdr:y']).optional();

// ============================================
// Auth
// ============================================
const RegisterBody = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(3).max(253),
  email: z.string().email()
});

// ============================================
// Keywords
// ============================================
const KeywordSearchBody = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(500),
  domain: z.string().min(3),
  region: RegionCode.optional(),
  location: z.string().optional(),
  country: RegionCode.optional(),
  tbs: TbsFilter
});

const KeywordClusterBody = z.object({
  keywords: z.array(z.string().min(1)).min(2).max(500)
});

const KeywordSuggestBody = z.object({
  topic: z.string().min(1),
  count: z.number().int().min(5).max(100).default(20)
});

// ============================================
// Competitors
// ============================================
const CompetitorCrawlBody = z.object({
  domain: z.string().min(3),
  maxPages: z.number().int().min(1).max(200).default(50),
  includePaths: z.array(z.string()).optional()
});

const CompetitorScrapeBody = z.object({
  url: z.string().url(),
  formats: z.array(z.string()).default(['markdown'])
});

const CompetitorCompareBody = z.object({
  keyword: z.string().min(1),
  domain: z.string().min(3),
  competitorDomain: z.string().min(3)
});

// ============================================
// Content
// ============================================
const ContentGenerateBody = z.object({
  keyword: z.string().min(1),
  segment: z.string().default('general'),
  tone: z.string().default('professional'),
  targetWordCount: z.number().int().min(500).max(5000).default(1800)
});

const ContentBriefBody = z.object({
  keyword: z.string().min(1),
  competitors: z.array(z.string()).optional()
});

const ContentRefreshBody = z.object({
  url: z.string().url(),
  keyword: z.string().min(1)
});

const ContentTrendingBody = z.object({
  topic: z.string().min(1),
  timeRange: z.enum(['day', 'week', 'month']).default('week')
});

// ============================================
// Rankings
// ============================================
const RankCheckBody = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(500),
  domain: z.string().min(3),
  region: RegionCode.optional(),
  country: RegionCode.optional(),
  location: z.string().optional()
});

const RankGlobalBody = z.object({
  keyword: z.string().min(1),
  domain: z.string().min(3),
  regions: z.array(RegionCode).min(1).max(20)
});

// ============================================
// Monitor
// ============================================
const MonitorWatchBody = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  frequency: z.enum(['hourly', 'daily', 'weekly', 'monthly']).default('daily')
});

const MonitorCheckBody = z.object({
  urls: z.array(z.string().url()).optional()  // empty = all active
});

const MonitorPricingBody = z.object({
  url: z.string().url(),
  schema: z.record(z.any()).optional()  // custom JSON schema for pricing fields
});

// ============================================
// Audit
// ============================================
const AuditTechnicalBody = z.object({
  url: z.string().optional(),
  domain: z.string().optional(),
  maxPages: z.number().int().min(1).max(200).default(10)
}).refine(d => d.url || d.domain, { message: 'Provide url or domain' });

const AuditBatchBody = z.object({
  urls: z.array(z.string().url()).min(1).max(200)
});

const AuditInternalLinksBody = z.object({
  domain: z.string().min(3),
  maxPages: z.number().int().min(10).max(500).default(100)
});

// ============================================
// GEO / AEO
// ============================================
const GeoBrandMonitorBody = z.object({
  brand: z.string().min(1),
  competitors: z.array(z.string()).optional(),
  queries: z.array(z.string()).optional()
});

const GeoReadabilityBody = z.object({
  url: z.string().optional(),
  domain: z.string().optional(),
  maxPages: z.number().int().min(1).max(50).default(5)
}).refine(d => d.url || d.domain, { message: 'Provide url or domain' });

const GeoLlmstxtBody = z.object({
  domain: z.string().min(3),
  maxUrls: z.number().int().min(5).max(200).default(50)
});

const GeoOptimizeBody = z.object({
  domain: z.string().min(3),
  brand: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(20)
});

// ============================================
// Intelligence
// ============================================
const IntelligenceAnalyzeBody = z.object({
  domain: z.string().min(3),
  keywords: z.array(z.string().min(1)).min(1).max(50),
  competitors: z.array(z.string()).optional()
});

const IntelligenceGapsBody = z.object({
  domain: z.string().min(3),
  competitorDomain: z.string().min(3),
  keywords: z.array(z.string().min(1)).min(1).max(50)
});

const IntelligenceAgentBody = z.object({
  prompt: z.string().min(10),
  urls: z.array(z.string().url()).optional(),
  schema: z.record(z.any()).optional(),
  model: z.enum(['spark-1-mini', 'spark-1-pro']).default('spark-1-mini')
});

// ============================================
// Domain
// ============================================
const DomainMapBody = z.object({
  url: z.string().url(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(10000).default(5000)
});

// ============================================
// Search
// ============================================
const SearchNewsBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  country: z.string().length(2).optional(),
  tbs: z.enum(['qdr:h', 'qdr:d', 'qdr:w', 'qdr:m', 'qdr:y']).optional()
});

const SearchGithubBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional()
});

const SearchResearchBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional()
});

// ============================================
// Brand
// ============================================
const BrandMentionsBody = z.object({
  brand: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  tbs: z.enum(['qdr:h', 'qdr:d', 'qdr:w', 'qdr:m', 'qdr:y']).optional()
});

const BrandImagesBody = z.object({
  brand: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional()
});

// ============================================
// Intelligence Batch
// ============================================
const IntelligenceBatchBody = z.object({
  prompts: z.array(z.object({
    topic: z.string().min(1),
    depth: z.enum(['shallow', 'deep']).optional()
  })).min(1).max(5),
  model: z.enum(['spark-1-mini', 'spark-1-pro']).optional()
});

// ============================================
// Competitors Scrape Interactive
// ============================================
const CompetitorScrapeInteractiveBody = z.object({
  url: z.string().url(),
  actions: z.array(z.object({
    type: z.enum(['click', 'scroll', 'wait', 'input']),
    selector: z.string().optional(),
    text: z.string().optional()
  })).optional(),
  waitFor: z.string().optional()
});

// ============================================
// Rankings SERP Snapshot
// ============================================
const RankSerpSnapshotBody = z.object({
  keyword: z.string().min(1),
  country: z.string().length(2).optional()
});

// ============================================
// Pipeline
// ============================================
const PipelineRunBody = z.object({
  domain: z.string().min(3),
  keywords: z.array(z.string().min(1)).min(1).max(100),
  competitors: z.array(z.string()).optional(),
  region: RegionCode.default('US')
});

module.exports = {
  RegisterBody,
  KeywordSearchBody, KeywordClusterBody, KeywordSuggestBody,
  CompetitorCrawlBody, CompetitorScrapeBody, CompetitorCompareBody,
  ContentGenerateBody, ContentBriefBody, ContentRefreshBody, ContentTrendingBody,
  RankCheckBody, RankGlobalBody,
  MonitorWatchBody, MonitorCheckBody, MonitorPricingBody,
  AuditTechnicalBody, AuditBatchBody, AuditInternalLinksBody,
  GeoBrandMonitorBody, GeoReadabilityBody, GeoLlmstxtBody, GeoOptimizeBody,
  IntelligenceAnalyzeBody, IntelligenceGapsBody, IntelligenceAgentBody,
  SearchNewsBody, SearchGithubBody, SearchResearchBody,
  BrandMentionsBody, BrandImagesBody,
  IntelligenceBatchBody, CompetitorScrapeInteractiveBody, RankSerpSnapshotBody,
  DomainMapBody,
  PipelineRunBody
};
