/**
 * Google Search Console Service
 * Pulls clicks, impressions, CTR, position data for a verified site.
 *
 * Install deps: npm install googleapis
 *
 * OAuth flow:
 * 1. Each org connects their GSC account via OAuth (stored in OrgGSCToken table)
 * 2. We refresh token as needed and pull daily data
 */

const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4200/api/auth/gsc/callback';

function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/**
 * Generate OAuth URL for user to connect their GSC account.
 */
function getAuthUrl(state) {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    state,
  });
}

/**
 * Exchange code for tokens after OAuth callback.
 */
async function exchangeCode(code) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Build an authenticated Search Console client from stored tokens.
 * @param {{ accessToken: string, refreshToken: string }} tokens
 */
function buildSearchConsole(tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  return google.searchconsole({ version: 'v1', auth: oauth2Client });
}

/**
 * Get performance data (clicks, impressions, CTR, position) for a site.
 */
async function getSitePerformance(tokens, siteUrl, opts = {}) {
  const { days = 90, dimensions = ['query', 'page', 'device'], rowLimit = 1000 } = opts;

  const sc = buildSearchConsole(tokens);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const response = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      dimensions,
      rowLimit,
      dataState: 'all',
    },
  });

  return response.data.rows || [];
}

/**
 * Get top keywords by impressions for a site.
 */
async function getTopKeywords(tokens, siteUrl, limit = 100) {
  const rows = await getSitePerformance(tokens, siteUrl, {
    days: 90,
    dimensions: ['query'],
    rowLimit: limit,
  });

  return rows
    .sort((a, b) => b.impressions - a.impressions)
    .map((r) => ({
      keyword: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: parseFloat((r.ctr * 100).toFixed(2)),
      position: parseFloat(r.position.toFixed(1)),
    }));
}

/**
 * Get top pages by clicks.
 */
async function getTopPages(tokens, siteUrl, limit = 50) {
  const rows = await getSitePerformance(tokens, siteUrl, {
    days: 90,
    dimensions: ['page'],
    rowLimit: limit,
  });

  return rows
    .sort((a, b) => b.clicks - a.clicks)
    .map((r) => ({
      page: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: parseFloat((r.ctr * 100).toFixed(2)),
      position: parseFloat(r.position.toFixed(1)),
    }));
}

/**
 * Detect ranking drops vs previous period.
 * Returns keywords that dropped 3+ positions.
 */
async function detectRankingDrops(tokens, siteUrl) {
  const sc = buildSearchConsole(tokens);

  const now = new Date();
  const period = (offsetDays, rangeDays) => {
    const end = new Date(now);
    end.setDate(end.getDate() - offsetDays);
    const start = new Date(end);
    start.setDate(start.getDate() - rangeDays);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  };

  const current = period(0, 28);
  const previous = period(28, 28);

  const [currentRes, previousRes] = await Promise.all([
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: current.start, endDate: current.end, dimensions: ['query'], rowLimit: 500 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: previous.start, endDate: previous.end, dimensions: ['query'], rowLimit: 500 },
    }),
  ]);

  const currentMap = {};
  for (const r of currentRes.data.rows || []) {
    currentMap[r.keys[0]] = r.position;
  }

  const drops = [];
  for (const r of previousRes.data.rows || []) {
    const keyword = r.keys[0];
    const prevPos = r.position;
    const currPos = currentMap[keyword];
    if (currPos && currPos - prevPos >= 3) {
      drops.push({
        keyword,
        previousPosition: parseFloat(prevPos.toFixed(1)),
        currentPosition: parseFloat(currPos.toFixed(1)),
        drop: parseFloat((currPos - prevPos).toFixed(1)),
      });
    }
  }

  return drops.sort((a, b) => b.drop - a.drop);
}

/**
 * Get site's verified properties list.
 */
async function listSites(tokens) {
  const sc = buildSearchConsole(tokens);
  const res = await sc.sites.list();
  return res.data.siteEntry || [];
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  getSitePerformance,
  getTopKeywords,
  getTopPages,
  detectRankingDrops,
  listSites,
};
