// ============================================
// Firecrawl Scraping Service
// Handles all web scraping operations:
// - Keyword search
// - Competitor crawling
// - Rank tracking
// - Content research
// ============================================

const FIRECRAWL_BASE = process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev/v2';
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

class FirecrawlService {
  constructor() {
    if (!FIRECRAWL_KEY) {
      throw new Error('FIRECRAWL_API_KEY is required');
    }
    this.headers = {
      'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      'Content-Type': 'application/json'
    };
    this.creditsUsed = 0;
  }

  // ============================================
  // KEYWORD SEARCH
  // Search for a keyword and get top results
  // Cost: ~2 credits per 10 results
  // ============================================
  async searchKeyword(keyword, options = {}) {
    const { limit = 10, location = null, language = 'en' } = options;
    
    try {
      const body = {
        query: keyword,
        limit,
        scrapeOptions: {
          formats: ['markdown', 'links']
        }
      };

      if (location) body.location = location;
      if (language) body.lang = language;

      const response = await fetch(`${FIRECRAWL_BASE}/search`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Firecrawl search failed: ${response.status} - ${error}`);
      }

      const data = await response.json();
      this.creditsUsed += 2;

      return {
        success: true,
        keyword,
        results: (data.data?.web || data.data || []).map((r, i) => ({
          position: i + 1,
          url: r.url || '',
          title: r.title || '',
          description: r.description || '',
          domain: r.url ? new URL(r.url).hostname.replace('www.', '') : '',
          markdown: r.markdown?.substring(0, 500) || '' // First 500 chars for analysis
        })),
        totalResults: data.data?.web?.length || 0
      };
    } catch (error) {
      console.error(`Search failed for "${keyword}":`, error.message);
      return { success: false, keyword, error: error.message, results: [] };
    }
  }

  // ============================================
  // BATCH KEYWORD SEARCH
  // Search multiple keywords with rate limiting
  // ============================================
  async batchSearchKeywords(keywords, options = {}) {
    const { concurrency = 3, delayMs = 1000 } = options;
    const results = [];
    
    // Process in batches to respect rate limits
    for (let i = 0; i < keywords.length; i += concurrency) {
      const batch = keywords.slice(i, i + concurrency);
      
      const batchResults = await Promise.allSettled(
        batch.map(kw => this.searchKeyword(
          typeof kw === 'string' ? kw : kw.keyword,
          options
        ))
      );

      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          results.push({
            ...result.value,
            segment: batch[idx].segment || 'core',
            priority: batch[idx].priority || 2
          });
        } else {
          results.push({
            success: false,
            keyword: batch[idx].keyword || batch[idx],
            error: result.reason?.message || 'Unknown error',
            results: []
          });
        }
      });

      // Rate limit delay between batches
      if (i + concurrency < keywords.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  // ============================================
  // COMPETITOR CRAWL
  // Crawl a competitor's blog/content pages
  // Cost: ~1 credit per page
  // ============================================
  async crawlCompetitor(domain, blogPath = '/blog', options = {}) {
    const { limit = 20, depth = 2 } = options;
    
    try {
      const response = await fetch(`${FIRECRAWL_BASE}/crawl`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          url: `https://${domain}${blogPath}`,
          limit,
          maxDepth: depth,
          scrapeOptions: {
            formats: ['markdown'],
            onlyMainContent: true
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Crawl failed: ${response.status}`);
      }

      const data = await response.json();
      this.creditsUsed += limit;

      // Firecrawl crawl is async - we get a job ID
      if (data.id) {
        return await this._pollCrawlResult(data.id);
      }

      return this._processCompetitorPages(domain, data.data || []);
    } catch (error) {
      console.error(`Crawl failed for ${domain}:`, error.message);
      return { success: false, domain, error: error.message, pages: [] };
    }
  }

  // Poll for async crawl results
  async _pollCrawlResult(jobId, maxWaitMs = 120000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await fetch(`${FIRECRAWL_BASE}/crawl/${jobId}`, {
          headers: this.headers
        });
        
        const data = await response.json();
        
        if (data.status === 'completed') {
          return {
            success: true,
            pages: data.data || [],
            totalPages: data.total || 0
          };
        }
        
        if (data.status === 'failed') {
          throw new Error('Crawl job failed');
        }
        
        // Wait 5 seconds before polling again
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        throw error;
      }
    }
    
    throw new Error('Crawl job timed out');
  }

  // Process crawled pages into structured data
  _processCompetitorPages(domain, pages) {
    const processed = pages.map(page => {
      const markdown = page.markdown || '';
      const metadata = page.metadata || {};

      // Extract headings
      const h1s = (markdown.match(/^# .+$/gm) || []).map(h => h.replace(/^# /, ''));
      const h2s = (markdown.match(/^## .+$/gm) || []).map(h => h.replace(/^## /, ''));
      const h3s = (markdown.match(/^### .+$/gm) || []).map(h => h.replace(/^### /, ''));

      // Extract links
      const links = (markdown.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).map(link => {
        const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
        return match ? { text: match[1], url: match[2] } : null;
      }).filter(Boolean);

      const wordCount = markdown.split(/\s+/).length;

      return {
        url: metadata.sourceURL || page.url || '',
        title: metadata.title || h1s[0] || 'Untitled',
        description: metadata.description || '',
        headings: { h1s, h2s, h3s },
        wordCount,
        readTimeMinutes: Math.ceil(wordCount / 200),
        internalLinks: links.filter(l => l.url.includes(domain)).length,
        externalLinks: links.filter(l => !l.url.includes(domain)).length,
        hasImages: (markdown.match(/!\[/g) || []).length,
        publishDate: metadata.publishedTime || null,
        // Extract key topics from headings
        topics: [...h1s, ...h2s].map(h => h.toLowerCase())
      };
    });

    return {
      success: true,
      domain,
      totalPages: processed.length,
      avgWordCount: processed.length > 0
        ? Math.round(processed.reduce((sum, p) => sum + p.wordCount, 0) / processed.length)
        : 0,
      pages: processed,
      allTopics: [...new Set(processed.flatMap(p => p.topics))]
    };
  }

  // ============================================
  // RANK TRACKING
  // Check where a domain ranks for specific keywords
  // ============================================
  async trackRanking(keyword, targetDomain) {
    const searchResult = await this.searchKeyword(keyword, { limit: 20 });
    
    if (!searchResult.success) {
      return { keyword, position: null, error: searchResult.error };
    }

    const domainClean = targetDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    
    const ourResult = searchResult.results.find(r => 
      r.domain.includes(domainClean)
    );

    return {
      keyword,
      position: ourResult ? ourResult.position : null,
      url: ourResult?.url || null,
      isRanking: !!ourResult,
      topResults: searchResult.results.slice(0, 5),
      competitorPositions: this._extractCompetitorPositions(searchResult.results),
      checkedAt: new Date().toISOString()
    };
  }

  // ============================================
  // CONTENT RESEARCH
  // Deep-research a topic using Firecrawl's agent
  // ============================================
  async researchTopic(prompt) {
    try {
      const response = await fetch(`${FIRECRAWL_BASE}/agent`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          prompt,
          timeout: 60000
        })
      });

      if (!response.ok) {
        throw new Error(`Agent research failed: ${response.status}`);
      }

      const data = await response.json();
      this.creditsUsed += 10; // Agent uses more credits

      return {
        success: true,
        data: data.data || data,
        sources: data.sources || []
      };
    } catch (error) {
      console.error('Research failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // URL MAP
  // Get all URLs from a domain (for site audit)
  // ============================================
  async mapDomain(domain, options = {}) {
    const { search = null, limit = 1000 } = options;
    
    try {
      const body = {
        url: `https://${domain}`,
        limit
      };
      if (search) body.search = search;

      const response = await fetch(`${FIRECRAWL_BASE}/map`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      const data = await response.json();
      this.creditsUsed += 1;

      return {
        success: true,
        domain,
        urls: data.links || data.data || [],
        totalUrls: (data.links || data.data || []).length
      };
    } catch (error) {
      return { success: false, domain, error: error.message, urls: [] };
    }
  }

  // ============================================
  // HELPERS
  // ============================================
  _extractCompetitorPositions(results) {
    const competitorDomains = [
      'wise.com', 'remitly.com', 'worldremit.com',
      'mercury.com', 'chime.com', 'novacredit.com',
      'nerdwallet.com', 'bankrate.com', 'creditkarma.com'
    ];

    const positions = {};
    results.forEach(r => {
      competitorDomains.forEach(comp => {
        if (r.domain.includes(comp.replace('www.', ''))) {
          positions[comp] = r.position;
        }
      });
    });
    return positions;
  }

  getCreditsUsed() {
    return this.creditsUsed;
  }

  resetCreditsCounter() {
    this.creditsUsed = 0;
  }
}

module.exports = { FirecrawlService };
