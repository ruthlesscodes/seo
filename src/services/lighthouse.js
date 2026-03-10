/**
 * Lighthouse Service — via Google PageSpeed Insights API
 *
 * Same Lighthouse scores, zero server overhead. No Chrome, no Chromium.
 * Set GOOGLE_PAGESPEED_API_KEY in Railway (free: 25,000 req/day).
 *
 * Bonus: PageSpeed API returns real user field data from Chrome UX Report.
 */

const PAGESPEED_API_KEY = process.env.GOOGLE_PAGESPEED_API_KEY;
const PAGESPEED_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

async function runLighthouseAudit(url, options = {}) {
  const { strategy = 'mobile' } = options;

  if (!PAGESPEED_API_KEY) {
    throw new Error(
      'GOOGLE_PAGESPEED_API_KEY is required. Get one free: https://developers.google.com/speed/docs/insights/v5/get-started'
    );
  }

  const apiUrl = `${PAGESPEED_BASE}?url=${encodeURIComponent(url)}&key=${PAGESPEED_API_KEY}&strategy=${strategy}&category=performance&category=seo&category=accessibility&category=best-practices`;

  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60_000) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PageSpeed API error ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const lhr = data.lighthouseResult;

  if (!lhr) throw new Error('No Lighthouse result returned from PageSpeed API');

  const scores = {
    performance: Math.round((lhr.categories.performance?.score || 0) * 100),
    seo: Math.round((lhr.categories.seo?.score || 0) * 100),
    accessibility: Math.round((lhr.categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((lhr.categories['best-practices']?.score || 0) * 100),
  };

  const cwv = {
    lcp: lhr.audits['largest-contentful-paint']?.numericValue || null,
    cls: lhr.audits['cumulative-layout-shift']?.numericValue || null,
    fcp: lhr.audits['first-contentful-paint']?.numericValue || null,
    ttfb: lhr.audits['server-response-time']?.numericValue || null,
    tbt: lhr.audits['total-blocking-time']?.numericValue || null,
  };

  const cwvDisplay = {
    lcp: lhr.audits['largest-contentful-paint']?.displayValue || null,
    cls: lhr.audits['cumulative-layout-shift']?.displayValue || null,
    fcp: lhr.audits['first-contentful-paint']?.displayValue || null,
    ttfb: lhr.audits['server-response-time']?.displayValue || null,
    tbt: lhr.audits['total-blocking-time']?.displayValue || null,
  };

  const SEO_AUDIT_IDS = [
    'meta-description', 'document-title', 'html-has-lang', 'canonical',
    'robots-txt', 'image-alt', 'link-text', 'crawlable-anchors',
    'hreflang', 'is-crawlable', 'structured-data', 'font-size',
    'tap-targets', 'http-status-code',
  ];

  const seoIssues = SEO_AUDIT_IDS
    .map((id) => lhr.audits[id])
    .filter((a) => a && a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'notApplicable')
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      score: a.score,
      displayValue: a.displayValue || null,
      severity: a.score === 0 ? 'critical' : 'warning',
    }));

  const opportunities = Object.values(lhr.audits)
    .filter((a) => a.details?.type === 'opportunity' && (a.numericValue || 0) > 0)
    .map((a) => ({
      id: a.id,
      title: a.title,
      savingsMs: Math.round(a.numericValue || 0),
      displayValue: a.displayValue,
    }))
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 10);

  // Real user field data from Chrome UX Report (PageSpeed bonus)
  const fieldData = data.loadingExperience?.metrics
    ? {
        lcpCategory: data.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS?.category || null,
        fidCategory: data.loadingExperience.metrics.FIRST_INPUT_DELAY_MS?.category || null,
        clsCategory: data.loadingExperience.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category || null,
        fcpCategory: data.loadingExperience.metrics.FIRST_CONTENTFUL_PAINT_MS?.category || null,
        overallCategory: data.loadingExperience.overall_category || null,
      }
    : null;

  return {
    success: true,
    url,
    strategy,
    scores,
    cwv,
    cwvDisplay,
    fieldData,
    seoIssues,
    opportunities,
    fetchTime: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
  };
}

async function runBatchLighthouseAudit(urls, opts = {}) {
  const { strategy = 'mobile', delayMs = 1000 } = opts;
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      results.push(await runLighthouseAudit(urls[i], { strategy }));
    } catch (err) {
      results.push({ success: false, url: urls[i], error: err.message });
    }
    if (i < urls.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

function summariseLighthouseResult(result) {
  if (!result || !result.success) return null;
  return {
    performanceScore: result.scores?.performance,
    seoScore: result.scores?.seo,
    accessibilityScore: result.scores?.accessibility,
    bestPracticesScore: result.scores?.bestPractices,
    lcpMs: result.cwv?.lcp ? Math.round(result.cwv.lcp) : null,
    clsScore: result.cwv?.cls,
    fcpMs: result.cwv?.fcp ? Math.round(result.cwv.fcp) : null,
    ttfbMs: result.cwv?.ttfb ? Math.round(result.cwv.ttfb) : null,
    tbtMs: result.cwv?.tbt ? Math.round(result.cwv.tbt) : null,
    seoIssueCount: result.seoIssues?.length || 0,
  };
}

module.exports = { runLighthouseAudit, runBatchLighthouseAudit, summariseLighthouseResult };
