/**
 * Firecrawl Service — wraps all /v2 endpoints
 *
 * Endpoints used:
 *   POST /v2/scrape         — single URL → markdown, html, json, screenshot, branding, changeTracking, summary, images, links
 *   POST /v2/search         — web search with sources (web, news, images), categories (github, research), tbs time filters
 *   POST /v2/crawl          — recursive site crawl with depth, includes/excludes, changeTracking
 *   POST /v2/map            — fast URL discovery from sitemap + SERP + cache
 *   POST /v2/batch/scrape   — parallel URL scraping with maxConcurrency + webhooks
 *   POST /v2/agent          — autonomous AI research with Spark 1 Mini/Pro models
 *
 * Key formats for SEO:
 *   "markdown"       — clean content
 *   "html"           — raw HTML
 *   "links"          — all links on page
 *   "screenshot"     — PNG capture (fullPage, quality, viewport options)
 *   "json"           — structured extraction with schema or prompt (costs +4 credits)
 *   "changeTracking" — diff against previous scrape (modes: "git-diff", "json")
 *   "branding"       — colors, fonts, logo, typography
 *   "summary"        — AI-generated page summary
 *   "images"         — all image URLs
 */

const BASE_URL = process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev/v2';
const API_KEY = process.env.FIRECRAWL_API_KEY;

const FIRECRAWL_TIMEOUT_MS = Number(process.env.FIRECRAWL_TIMEOUT_MS) || 90000;

async function firecrawlRequest(endpoint, body = {}, method = 'POST', timeoutMs = FIRECRAWL_TIMEOUT_MS) {
  const url = `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const options = {
    method,
    signal: controller.signal,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    }
  };
  if (method !== 'GET') options.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      const err = new Error(`Firecrawl request timed out after ${timeoutMs}ms`);
      err.status = 504;
      throw err;
    }
    throw e;
  }
  clearTimeout(timeout);
  const data = await res.json();

  if (!res.ok || data.success === false) {
    const err = new Error(data.error || `Firecrawl ${endpoint} failed`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// ============================================
// SCRAPE — single URL, multiple formats
// ============================================

async function scrape(url, options = {}) {
  const {
    formats = ['markdown'],
    onlyMainContent = true,
    includeTags,
    excludeTags,
    waitFor,
    timeout = 30000,
    location,           // { country: "PH", languages: ["tl", "en"] }
    actions,            // [{ type: "click", selector: "#tab" }, ...]
    mobile = false,
    jsonSchema,         // pass schema for structured extraction
    jsonPrompt,         // or just a prompt
    changeTrackingModes,// ["git-diff"] or ["json"]
    changeTrackingSchema,
    changeTrackingTag
  } = options;

  // Build formats array
  const formatsArr = [...formats];

  // Add JSON extraction if schema or prompt provided
  if (jsonSchema || jsonPrompt) {
    const jsonFormat = { type: 'json' };
    if (jsonSchema) jsonFormat.schema = jsonSchema;
    if (jsonPrompt) jsonFormat.prompt = jsonPrompt;
    formatsArr.push(jsonFormat);
  }

  // Add change tracking if modes provided
  if (changeTrackingModes) {
    const ct = { type: 'changeTracking', modes: changeTrackingModes };
    if (changeTrackingSchema) ct.schema = changeTrackingSchema;
    if (changeTrackingTag) ct.tag = changeTrackingTag;
    formatsArr.push(ct);
  }

  const body = { url, formats: formatsArr, onlyMainContent, timeout, mobile };
  if (includeTags) body.includeTags = includeTags;
  if (excludeTags) body.excludeTags = excludeTags;
  if (waitFor) body.waitFor = waitFor;
  if (location) body.location = location;
  if (actions) body.actions = actions;

  return firecrawlRequest('/scrape', body);
}

// ============================================
// SEARCH — web, news, images with filters
// ============================================

async function search(query, options = {}) {
  const {
    limit = 5,
    sources = ['web'],        // "web", "news", "images"
    categories,               // [{ type: "github" }], [{ type: "research" }]
    tbs,                      // "qdr:h", "qdr:d", "qdr:w", "qdr:m", "qdr:y" or custom date range
    location,                 // "San Francisco,California,United States"
    country = 'US',           // ISO code
    scrapeOptions,            // { formats: ["markdown"], onlyMainContent: true }
    timeout = 60000
  } = options;

  const body = { query, limit, sources, country, timeout };
  if (categories) body.categories = categories;
  if (tbs) body.tbs = tbs;
  if (location) body.location = location;
  if (scrapeOptions) body.scrapeOptions = scrapeOptions;

  return firecrawlRequest('/search', body);
}

// ============================================
// CRAWL — recursive site crawl (async)
// ============================================

async function crawl(url, options = {}) {
  const {
    limit = 50,
    maxDepth = 3,
    includePaths,             // ["blog/.*", "docs/.*"]
    excludePaths,             // ["admin/.*"]
    formats = ['markdown'],
    onlyMainContent = true,
    allowSubdomains = false,
    changeTracking = false,
    webhook                   // { url: "...", events: ["completed"] }
  } = options;

  const formatsArr = [...formats];
  if (changeTracking) {
    formatsArr.push({ type: 'changeTracking', modes: ['git-diff'] });
  }

  const body = {
    url, limit, maxDepth, formats: formatsArr,
    onlyMainContent, allowSubdomains
  };
  if (includePaths) body.includePaths = includePaths;
  if (excludePaths) body.excludePaths = excludePaths;
  if (webhook) body.webhook = webhook;

  return firecrawlRequest('/crawl', body);
}

async function getCrawlStatus(crawlId) {
  return firecrawlRequest(`/crawl/${crawlId}`, {}, 'GET');
}

// ============================================
// MAP — fast URL discovery (1 credit regardless of URL count)
// ============================================

async function map(url, options = {}) {
  const {
    limit = 5000,
    search: searchFilter,       // filter URLs by keyword
    sitemap = 'include',        // "include", "only", "ignore"
    includeSubdomains = false,
    location                    // { country: "US", languages: ["en"] }
  } = options;

  const body = { url, limit, sitemap, includeSubdomains };
  if (searchFilter) body.search = searchFilter;
  if (location) body.location = location;

  return firecrawlRequest('/map', body);
}

// ============================================
// BATCH SCRAPE — parallel URL processing
// ============================================

async function batchScrape(urls, options = {}) {
  const {
    formats = ['markdown'],
    onlyMainContent = true,
    maxConcurrency,
    webhook,                  // { url: "...", events: ["completed"] }
    jsonSchema,
    jsonPrompt,
    changeTrackingModes
  } = options;

  const formatsArr = [...formats];
  if (jsonSchema || jsonPrompt) {
    const jf = { type: 'json' };
    if (jsonSchema) jf.schema = jsonSchema;
    if (jsonPrompt) jf.prompt = jsonPrompt;
    formatsArr.push(jf);
  }
  if (changeTrackingModes) {
    formatsArr.push({ type: 'changeTracking', modes: changeTrackingModes });
  }

  const body = { urls, formats: formatsArr, onlyMainContent, ignoreInvalidURLs: true };
  if (maxConcurrency) body.maxConcurrency = maxConcurrency;
  if (webhook) body.webhook = webhook;

  return firecrawlRequest('/batch/scrape', body);
}

async function getBatchStatus(batchId) {
  return firecrawlRequest(`/batch/scrape/${batchId}`, {}, 'GET');
}

// ============================================
// AGENT — autonomous AI research (Spark 1 models)
// ============================================

async function agent(prompt, options = {}) {
  const {
    urls,                     // optional starting URLs
    schema,                   // JSON schema or Pydantic-style
    model = 'spark-1-mini',   // "spark-1-mini" (default, 60% cheaper) or "spark-1-pro"
    maxCredits = 100          // spending cap
  } = options;

  const body = { prompt, model, maxCredits };
  if (urls) body.urls = urls;
  if (schema) body.schema = schema;

  return firecrawlRequest('/agent', body);
}

async function getAgentStatus(agentId) {
  return firecrawlRequest(`/agent/${agentId}`, {}, 'GET');
}

module.exports = {
  scrape,
  search,
  crawl,
  getCrawlStatus,
  map,
  batchScrape,
  getBatchStatus,
  agent,
  getAgentStatus,
  firecrawlRequest
};
