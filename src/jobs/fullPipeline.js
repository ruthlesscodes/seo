// ============================================
// Full Pipeline Job
// Orchestrates the complete weekly cycle:
// 1. Scrape keywords
// 2. Crawl competitors
// 3. Analyze with Claude
// 4. Generate blog drafts
// 5. Track rankings
// 6. Send notifications
// ============================================

require('dotenv').config();
const { FirecrawlService } = require('../services/firecrawl');
const { ClaudeAnalysisService } = require('../services/claude');

class FullPipeline {
  constructor(config = {}) {
    this.firecrawl = new FirecrawlService();
    this.claude = new ClaudeAnalysisService();
    this.config = {
      orgDomain: config.orgDomain || 'getplu.com',
      orgContext: config.orgContext || 'Plu is a fintech neobank helping immigrants build credit in 6 months. Zero FX fees, virtual card qualification system, available at app.getplu.com.',
      keywords: config.keywords || [],
      competitors: config.competitors || [],
      ...config
    };
    this.results = {};
  }

  // ============================================
  // RUN THE FULL PIPELINE
  // ============================================
  async run() {
    const runId = `run_${Date.now()}`;
    const startTime = Date.now();
    
    console.log(`\n🚀 Starting Full SEO Pipeline [${runId}]`);
    console.log(`   Domain: ${this.config.orgDomain}`);
    console.log(`   Keywords: ${this.config.keywords.length}`);
    console.log(`   Competitors: ${this.config.competitors.length}`);
    console.log('');

    try {
      // ── Step 1: Keyword Research ──
      console.log('📊 Step 1/5: Scraping keywords...');
      const keywordResults = await this._scrapeKeywords();
      this.results.keywords = keywordResults;
      console.log(`   ✅ Scraped ${keywordResults.length} keywords`);
      console.log(`   📍 Ranking for ${keywordResults.filter(k => k.isRanking).length} keywords`);
      console.log(`   🎯 ${keywordResults.filter(k => !k.isRanking).length} content gaps found`);

      // ── Step 2: Competitor Analysis ──
      console.log('\n🔍 Step 2/5: Crawling competitors...');
      const competitorData = await this._crawlCompetitors();
      this.results.competitors = competitorData;
      console.log(`   ✅ Crawled ${competitorData.length} competitors`);
      competitorData.forEach(c => {
        console.log(`   📄 ${c.domain}: ${c.totalPages} pages, avg ${c.avgWordCount} words`);
      });

      // ── Step 3: AI Analysis ──
      console.log('\n🧠 Step 3/5: AI analysis & strategy...');
      const analysis = await this.claude.generateWeeklyBrief({
        keywordResults: keywordResults.map(k => ({
          keyword: k.keyword,
          segment: k.segment,
          results: k.topResults
        })),
        competitorData,
        orgDomain: this.config.orgDomain,
        orgContext: this.config.orgContext
      });
      this.results.analysis = analysis;
      console.log(`   ✅ Generated weekly brief`);
      console.log(`   📝 ${analysis.topOpportunities?.length || 0} opportunities identified`);
      console.log(`   📅 ${analysis.contentCalendar?.length || 0} blog posts planned`);

      // ── Step 4: Blog Generation ──
      console.log('\n✍️  Step 4/5: Generating blog drafts...');
      const blogDrafts = await this._generateBlogs(analysis);
      this.results.blogs = blogDrafts;
      console.log(`   ✅ Generated ${blogDrafts.length} blog drafts`);

      // ── Step 5: Rank Tracking ──
      console.log('\n📈 Step 5/5: Tracking rankings...');
      const rankings = await this._trackRankings();
      this.results.rankings = rankings;
      const rankingCount = rankings.filter(r => r.isRanking).length;
      console.log(`   ✅ Tracked ${rankings.length} keywords`);
      console.log(`   📍 Currently ranking for ${rankingCount}/${rankings.length}`);

      // ── Summary ──
      const duration = Math.round((Date.now() - startTime) / 1000);
      const creditsUsed = this.firecrawl.getCreditsUsed();

      const summary = {
        runId,
        duration: `${duration}s`,
        creditsUsed,
        keywordsScraped: keywordResults.length,
        competitorsCrawled: competitorData.length,
        contentGapsFound: keywordResults.filter(k => !k.isRanking).length,
        blogsGenerated: blogDrafts.length,
        currentRankings: rankingCount,
        headline: analysis.headline || 'Analysis complete'
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

  // ============================================
  // INTERNAL METHODS
  // ============================================

  async _scrapeKeywords() {
    const results = await this.firecrawl.batchSearchKeywords(
      this.config.keywords,
      { concurrency: 3, delayMs: 1500 }
    );

    return results.map(r => {
      const domainClean = this.config.orgDomain.replace(/^(www\.)?/, '');
      const ourResult = r.results?.find(res => 
        res.domain.includes(domainClean)
      );

      return {
        keyword: r.keyword,
        segment: r.segment || 'core',
        priority: r.priority || 2,
        isRanking: !!ourResult,
        ourPosition: ourResult?.position || null,
        ourUrl: ourResult?.url || null,
        topResults: r.results?.slice(0, 10) || [],
        opportunity: !ourResult ? 'HIGH' : (ourResult.position > 5 ? 'MEDIUM' : 'LOW')
      };
    });
  }

  async _crawlCompetitors() {
    const results = [];
    
    for (const comp of this.config.competitors) {
      console.log(`   🔄 Crawling ${comp.name || comp.domain}...`);
      const crawlResult = await this.firecrawl.crawlCompetitor(
        comp.domain,
        comp.blogPath || '/blog',
        { limit: 15 }
      );
      
      if (crawlResult.success) {
        results.push(crawlResult);
      } else {
        console.log(`   ⚠️  Failed to crawl ${comp.domain}: ${crawlResult.error}`);
      }
      
      // Delay between competitor crawls
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return results;
  }

  async _generateBlogs(analysis) {
    const drafts = [];
    const calendar = analysis.contentCalendar || [];
    
    // Generate first 2 blog posts from the calendar
    const postsToGenerate = calendar.slice(0, 2);
    
    for (const post of postsToGenerate) {
      console.log(`   📝 Writing: "${post.title}"...`);
      
      // Find competitor content for this keyword
      const competitorContent = this.results.competitors
        ?.flatMap(c => c.pages || [])
        .filter(p => {
          const topics = p.topics || [];
          return topics.some(t => 
            post.targetKeyword.toLowerCase().split(' ').some(kw => t.includes(kw))
          );
        })
        .slice(0, 3);

      const draft = await this.claude.generateBlogPost({
        title: post.title,
        targetKeyword: post.targetKeyword,
        secondaryKeywords: post.secondaryKeywords,
        segment: post.segment,
        outline: post.outline,
        wordCountTarget: post.wordCountTarget || 1500,
        orgContext: this.config.orgContext,
        competitorContent
      });

      if (draft.success) {
        drafts.push(draft);
      }
      
      // Delay between generations
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return drafts;
  }

  async _trackRankings() {
    // Track a subset of priority keywords
    const priorityKeywords = this.config.keywords
      .filter(k => k.priority === 1)
      .slice(0, 20);

    const rankings = [];
    
    for (const kw of priorityKeywords) {
      const ranking = await this.firecrawl.trackRanking(
        kw.keyword,
        this.config.orgDomain
      );
      rankings.push(ranking);
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return rankings;
  }
}

// ============================================
// CLI EXECUTION
// Run directly: node src/jobs/fullPipeline.js
// ============================================
if (require.main === module) {
  const pipeline = new FullPipeline({
    orgDomain: 'getplu.com',
    orgContext: 'Plu is a fintech neobank helping immigrants build credit in 6 months. Features: virtual card qualification (6 months usage + $500 spend + subscription), zero FX fees, targeting OFW, Nigerian diaspora, and US immigrant communities.',
    
    keywords: [
      // Core - Priority 1
      { keyword: 'build credit as immigrant', segment: 'core', priority: 1 },
      { keyword: 'credit card for immigrants', segment: 'core', priority: 1 },
      { keyword: 'neobank for immigrants', segment: 'core', priority: 1 },
      { keyword: 'no credit history banking', segment: 'core', priority: 1 },
      { keyword: 'immigrant credit building', segment: 'core', priority: 1 },
      
      // OFW - Priority 1
      { keyword: 'OFW remittance fees', segment: 'ofw', priority: 1 },
      { keyword: 'OFW banking abroad', segment: 'ofw', priority: 1 },
      { keyword: 'Filipino credit card abroad', segment: 'ofw', priority: 1 },
      
      // Nigerian - Priority 1
      { keyword: 'Nigerian diaspora banking', segment: 'nigerian', priority: 1 },
      { keyword: 'Japa banking guide', segment: 'nigerian', priority: 1 },
      
      // US Immigrant - Priority 2
      { keyword: 'H1B visa credit card', segment: 'us_immigrant', priority: 2 },
      { keyword: 'ITIN credit card', segment: 'us_immigrant', priority: 2 },
      { keyword: 'build credit with ITIN', segment: 'us_immigrant', priority: 2 },
      
      // Niche - Priority 2
      { keyword: 'digital nomad credit card', segment: 'niche', priority: 2 },
      { keyword: 'zero forex fee card', segment: 'niche', priority: 2 },
      { keyword: 'international student banking', segment: 'niche', priority: 2 }
    ],
    
    competitors: [
      { name: 'Wise', domain: 'wise.com', blogPath: '/blog' },
      { name: 'Remitly', domain: 'remitly.com', blogPath: '/blog' },
      { name: 'Nova Credit', domain: 'novacredit.com', blogPath: '/resources' },
      { name: 'Chime', domain: 'chime.com', blogPath: '/blog' }
    ]
  });

  pipeline.run()
    .then(result => {
      if (result.success) {
        // Save results to file for review
        const fs = require('fs');
        const outputPath = `./output/pipeline-${Date.now()}.json`;
        fs.mkdirSync('./output', { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        console.log(`\n📁 Full results saved to: ${outputPath}`);
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { FullPipeline };
