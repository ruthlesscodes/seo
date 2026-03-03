/**
 * node-cron scheduled jobs
 * - Monitor checks based on MonitoredUrl.checkFrequency (HOURLY, DAILY, WEEKLY, MONTHLY)
 * - Daily decay check for ranking drops
 */

const cron = require('node-cron');
const { prisma } = require('../utils/prisma');
const firecrawl = require('../services/firecrawl');
const { deliverWebhook } = require('../utils/webhookDelivery');
const { PLAN_LIMITS } = require('../utils/constants');

function isDueForCheck(monitored, frequency) {
  const last = monitored.lastCheckedAt ? new Date(monitored.lastCheckedAt) : null;
  const now = new Date();
  if (!last) return true;
  const msSince = now - last;
  const thresholds = {
    HOURLY: 60 * 60 * 1000,
    DAILY: 24 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000,
    MONTHLY: 30 * 24 * 60 * 60 * 1000
  };
  return msSince >= (thresholds[frequency] || thresholds.DAILY);
}

async function runMonitorChecks(frequency) {
  const urls = await prisma.monitoredUrl.findMany({
    where: { isActive: true, checkFrequency: frequency }
  });
  const due = urls.filter((u) => isDueForCheck(u, frequency));
  for (const monitored of due) {
    try {
      const org = await prisma.organization.findUnique({ where: { id: monitored.orgId } });
      const limits = PLAN_LIMITS[org?.plan] || PLAN_LIMITS.FREE;
      if (!limits.features?.includes?.('*') && !limits.features?.includes?.('monitor.check')) continue;

      const result = await firecrawl.scrape(monitored.url, {
        formats: ['markdown'],
        changeTrackingModes: ['git-diff'],
        changeTrackingTag: `org_${monitored.orgId}`
      });
      const ct = result.data?.changeTracking || result.changeTracking;
      const changeStatus = ct?.changeStatus || 'unchanged';

      await prisma.monitoredUrl.update({
        where: { id: monitored.id },
        data: { lastCheckedAt: new Date(), ...(changeStatus !== 'unchanged' ? { lastChangeAt: new Date() } : {}) }
      });

      if (changeStatus === 'changed' || changeStatus === 'new') {
        await prisma.changeEvent.create({
          data: {
            monitoredUrlId: monitored.id,
            changeStatus,
            changeType: 'content',
            diff: ct?.diff || null
          }
        });
        await deliverWebhook(monitored.orgId, 'monitor.changed', {
          url: monitored.url,
          label: monitored.label,
          changeStatus,
          detectedAt: new Date()
        });
      }
    } catch (e) {
      console.error(`Monitor check failed for ${monitored.url}:`, e.message);
    }
  }
}

async function runDecayCheck() {
  const orgs = await prisma.organization.findMany({
    where: { plan: { in: ['GROWTH', 'SCALE', 'ENTERPRISE'] } }
  });
  for (const org of orgs) {
    const limits = PLAN_LIMITS[org.plan] || {};
    if (!limits.features?.includes?.('*') && !limits.features?.includes?.('monitor.decay')) continue;

    try {
      const keywords = await prisma.keyword.findMany({ where: { orgId: org.id } });
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const decaying = [];

      for (const kw of keywords) {
        const [currentSnap, oldSnap] = await Promise.all([
          prisma.rankSnapshot.findFirst({
            where: { keywordId: kw.id },
            orderBy: { checkedAt: 'desc' }
          }),
          prisma.rankSnapshot.findFirst({
            where: { keywordId: kw.id, checkedAt: { lte: weekAgo } },
            orderBy: { checkedAt: 'desc' }
          })
        ]);
        if (!currentSnap || !oldSnap) continue;
        const prevPos = oldSnap.position;
        const currPos = currentSnap.position;
        if (prevPos != null && currPos != null && currPos - prevPos >= 3) {
          decaying.push({
            keyword: kw.keyword,
            previousPosition: prevPos,
            currentPosition: currPos,
            drop: currPos - prevPos,
            url: currentSnap.url
          });
        }
      }

      if (decaying.length > 0) {
        await deliverWebhook(org.id, 'ranking.dropped', {
          decaying,
          domain: org.domain,
          detectedAt: new Date()
        });
      }
    } catch (e) {
      console.error(`Decay check failed for org ${org.id}:`, e.message);
    }
  }
}

function startScheduler(logger) {
  const log = logger || console;

  cron.schedule('0 * * * *', () => {
    log.debug('Scheduler: running HOURLY monitor checks');
    runMonitorChecks('HOURLY').catch((e) => log.error(e));
  });

  cron.schedule('0 0 * * *', () => {
    log.debug('Scheduler: running DAILY monitor checks and decay');
    runMonitorChecks('DAILY').catch((e) => log.error(e));
    runDecayCheck().catch((e) => log.error(e));
  });

  cron.schedule('0 0 * * 0', () => {
    log.debug('Scheduler: running WEEKLY monitor checks');
    runMonitorChecks('WEEKLY').catch((e) => log.error(e));
  });

  cron.schedule('0 0 1 * *', () => {
    log.debug('Scheduler: running MONTHLY monitor checks');
    runMonitorChecks('MONTHLY').catch((e) => log.error(e));
  });

  log.info('Scheduler started (hourly, daily, weekly, monthly)');
}

module.exports = { startScheduler, runMonitorChecks, runDecayCheck };
