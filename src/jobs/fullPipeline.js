// ============================================
// Full Pipeline Job
// Uses real firecrawl + claude APIs (no fake service classes).
// Run: node src/jobs/fullPipeline.js
// ============================================

require('dotenv').config();
const { normalizeDomain } = require('../utils/domain');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');

class FullPipeline {
  constructor(config = {}) {
    this.config = {
      orgDomain: config.orgDomain || 'getplu.com',
      orgContext: config.orgContext || 'Plu is a fintech neobank helping immigrants build credit in 6 months. Zero FX fees, virtual card qualification system, available at app.getplu.com.',
      keywords: config.keywords || [],
      competitors: config.competitors || [],
      ...config
    };
    this.results = {};
  }

  async run() {
    const runId = `run_${Date.now()}`;
    const startTime = Date.now();

    console.log(`\n🚀 Starting Full SEO Pipeline [${runId}]`);
    console.log(`   Domain: ${this.config.orgDomain}`);
    console.log(`   Keywords: ${this.config.keywords.length}`);
    console.log(`   Competitors: ${this.config.competitors.length}`);
    console.log('');

    try {
      console.log('📊 Step 1/5: Scraping keywords...');
      const keywordResults = await this._scrapeKeywords();
      this.results.keywords = keywordResults;
      console.log(`   ✅ Scraped ${keywordResults.length} keywords`);
      console.log(`   📍 Ranking for ${keywordResults.filter(k => k.isRanking).length} keywords`);

      console.log('\n🔍 Step 2/5: Crawling competitors...');
      const competitorData = await this._crawlCompetitors();
      this.results.competitors = competitorData;
      console.log(`   ✅ Crawled ${competitorData.length} competitors`);

      console.log('\n🧠 Step 3/5: AI analysis & strategy...');
      const analysis = await this._generateWeeklyBrief(keywordResults, competitorData);
      this.results.analysis = analysis;
      console.log(`   ✅ Generated weekly brief`);

      console.log('\n✍️  Step 4/5: Generating blog drafts...');
      const blogDrafts = await this._generateBlogs(analysis);
      this.results.blogs = blogDrafts;
      console.log(`   ✅ Generated ${blogDrafts.length} blog drafts`);

      console.log('\n📈 Step 5/5: Tracking rankings...');
      const rankings = await this._trackRankings();
      this.results.rankings = rankings;
      console.log(`   ✅ Tracked ${rankings.length} keywords`);

      const duration = Math.round((Date.now() - startTime) / 1000);
      const summary = {
        runId,
        duration: `${duration}s`,
        keywordsScraped: keywordResults.length,
        competitorsCrawled: competitorData.length,
        blogsGenerated: blogDrafts.length,
        currentRankings: rankings.filter(r => r.isRanking).length,
        headline: analysis?.headline || 'Analysis complete'
      };

      console.log('\n' + '='.repeat(50));
      console.log('✅ PIPELINE COMPLETE');
      console.log('='.repeat(50));
      console.log(JSON.stringify(summary, null, 2));

      return {
        success: true,
        summary,
        analysis,
        blogDrafts,
        rankings,
        keywordResults,
        competitorData
      };
    } catch (error) {
      console.error('\n❌ Pipeline failed:', error.message);
      return {
        success: false,
        error: error.message,
        partialResults: this.results
      };
    }
  }

  async _scrapeKeywords() {
    const domainClean = normalizeDomain(this.config.orgDomain, { stripWww: true });
    const results = await Promise.allSettled(
      this.config.keywords.map(async (kw) => {
        const keyword = typeof kw === 'string' ? kw : kw.keyword;
        const res = await firecrawl.search(keyword, { limit: 10 });
        const webResults = res.data?.web || res.data?.results || [];
        const ourResult = webResults.find((r) => {
          const u = (r.url || '').toLowerCase();
          return u.includes(domainClean);
        });
        return {
          keyword,
          segment: kw.segment || 'core',
          priority: kw.priority || 2,
          isRanking: !!ourResult,
          ourPosition: ourResult?.position ?? null,
          ourUrl: ourResult?.url || null,
          topResults: webResults.slice(0, 10),
          opportunity: !ourResult ? 'HIGH' : (ourResult.position > 5 ? 'MEDIUM' : 'LOW')
        };
      })
    );
    return results.map((r) => (r.status === 'fulfilled' ? r.value : { keyword: '?', isRanking: false, topResults: [] }));
  }

  async _crawlCompetitors() {
    const results = [];
    for (const comp of this.config.competitors) {
      const domain = typeof comp === 'string' ? comp : comp.domain;
      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      try {
        console.log(`   🔄 Crawling ${domain}...`);
        const crawlRes = await firecrawl.crawl(url, { limit: 15, formats: ['markdown', 'links'] });
        const crawlId = crawlRes.id || crawlRes.data?.id;
        if (!crawlId) {
          results.push({ domain, success: false, error: 'No crawl ID' });
          continue;
        }
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await firecrawl.getCrawlStatus(crawlId);
          const s = status.status || status.data?.status;
          if (s === 'completed') {
            const data = status.data || status;
            const rawPages = data.data || data.completed || [];
            const pages = rawPages.map((p) => ({ url: p.metadata?.url || p.url, markdown: p.markdown }));
            results.push({
              domain,
              success: true,
              totalPages: pages.length,
              pages,
              avgWordCount: pages.reduce((a, p) => a + ((p.markdown || '').split(/\s+/).length || 0), 0) / (pages.length || 1) | 0
            });
            break;
          }
          if (s === 'failed') {
            results.push({ domain, success: false, error: status.error || 'Crawl failed' });
            break;
          }
        }
        if (results[results.length - 1]?.domain !== domain) {
          results.push({ domain, success: false, error: 'Timeout' });
        }
      } catch (e) {
        results.push({ domain, success: false, error: e.message });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  }

  async _generateWeeklyBrief(keywordResults, competitorData) {
    const input = JSON.stringify({
      keywordResults: keywordResults.map((k) => ({ keyword: k.keyword, segment: k.segment, isRanking: k.isRanking, topResults: k.topResults?.slice(0, 5) })),
      competitorData: competitorData.filter((c) => c.success).map((c) => ({ domain: c.domain, totalPages: c.totalPages })),
      orgDomain: this.config.orgDomain,
      orgContext: this.config.orgContext
    });
    const analysis = await claude.analyzeJSON(claude.PROMPTS.STRATEGIC_BRIEF, input);
    return {
      ...analysis,
      topOpportunities: analysis.topOpportunities || [],
      contentCalendar: analysis.contentCalendar || [],
      headline: analysis.summary || 'Analysis complete'
    };
  }

  async _generateBlogs(analysis) {
    const drafts = [];
    const calendar = analysis.contentCalendar || analysis.quickWins || [];
    const postsToGenerate = calendar.slice(0, 2);

    for (const post of postsToGenerate) {
      const title = post.title || post.topic || post.keyword || 'Blog post';
      const targetKeyword = post.targetKeyword || post.keyword || post.topic || 'SEO';
      const competitorContent = this.results.competitors
        ?.flatMap((c) => c.pages || [])
        .slice(0, 3)
        .map((p) => (p.markdown || '').slice(0, 500))
        .join('\n\n');

      try {
        const content = await claude.analyze(
          claude.PROMPTS.CONTENT_GENERATE,
          `Title: ${title}\nTarget keyword: ${targetKeyword}\nOrg context: ${this.config.orgContext}\n\nCompetitor context:\n${competitorContent || 'None'}`,
          { maxTokens: 4096 }
        );
        drafts.push({ success: true, title, targetKeyword, content });
      } catch (e) {
        drafts.push({ success: false, title, error: e.message });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return drafts;
  }

  async _trackRankings() {
    const priorityKeywords = this.config.keywords
      .filter((k) => (k.priority || 2) === 1)
      .slice(0, 20)
      .map((k) => (typeof k === 'string' ? k : k.keyword));

    const domainClean = normalizeDomain(this.config.orgDomain, { stripWww: true });

    const results = await Promise.allSettled(
      priorityKeywords.map(async (keyword) => {
        const res = await firecrawl.search(keyword, { limit: 10 });
        const webResults = res.data?.web || res.data?.results || [];
        const ourResult = webResults.find((r) => (r.url || '').toLowerCase().includes(domainClean));
        return {
          keyword,
          isRanking: !!ourResult,
          position: ourResult?.position ?? null,
          url: ourResult?.url || null
        };
      })
    );
    return results.map((r) => (r.status === 'fulfilled' ? r.value : { keyword: '?', isRanking: false }));
  }
}

if (require.main === module) {
  const pipeline = new FullPipeline({
    orgDomain: 'getplu.com',
    orgContext: 'Plu is a fintech neobank helping immigrants build credit in 6 months.',
    keywords: [
      { keyword: 'build credit as immigrant', segment: 'core', priority: 1 },
      { keyword: 'credit card for immigrants', segment: 'core', priority: 1 }
    ],
    competitors: [
      { domain: 'wise.com' },
      { domain: 'remitly.com' }
    ]
  });

  pipeline
    .run()
    .then((result) => {
      if (result.success) {
        const fs = require('fs');
        fs.mkdirSync('./output', { recursive: true });
        fs.writeFileSync(`./output/pipeline-${Date.now()}.json`, JSON.stringify(result, null, 2));
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { FullPipeline };
