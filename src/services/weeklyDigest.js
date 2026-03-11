/**
 * Weekly SEO Digest Service
 * Sends a beautiful HTML email with score, trend, priorities, monitor count.
 * Uses SMTP via nodemailer — works with any provider (Gmail, SendGrid, Mailgun, etc.).
 * Called by the scheduler every Monday at 8AM UTC.
 *
 * Set: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

const nodemailer = require('nodemailer');
const { prisma } = require('../utils/prisma');
const { PLAN_LIMITS } = require('../utils/constants');

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
  });
}

function scoreGrade(score) {
  if (score >= 90) return { grade: 'A', label: 'Excellent' };
  if (score >= 80) return { grade: 'B', label: 'Good' };
  if (score >= 70) return { grade: 'C', label: 'Average' };
  if (score >= 50) return { grade: 'D', label: 'Needs work' };
  return { grade: 'F', label: 'Critical issues' };
}

function scoreTrend(current, previous) {
  if (previous == null) return null;
  const delta = current - previous;
  if (delta > 0) return `↑ +${delta} from last week`;
  if (delta < 0) return `↓ ${delta} from last week`;
  return 'No change from last week';
}

/** Derive 0–100 score from audit summary or issuesFound */
function deriveScore(auditRun) {
  if (!auditRun) return 0;
  const summary = auditRun.summary;
  if (summary && typeof summary === 'object') {
    const c = (summary.critical ?? 0) * 10;
    const w = (summary.warnings ?? 0) * 3;
    const i = (summary.info ?? 0) * 1;
    return Math.max(0, Math.min(100, 100 - c - w - i));
  }
  const issues = auditRun.issuesFound ?? 0;
  return Math.max(0, Math.min(100, 100 - issues * 2));
}

function buildDigestEmail({ orgName, domain, score, previousScore, topPriorities, changeCount, creditsRemaining }) {
  const { grade, label } = scoreGrade(score);
  const trend = scoreTrend(score, previousScore);
  const scoreColor = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  const dashboardUrl = process.env.DASHBOARD_URL || process.env.API_BASE_URL || 'https://your-dashboard.up.railway.app';

  const priorityRows = topPriorities.slice(0, 3).map(
    (p, i) => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #1a2235;">
        <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${scoreColor}18;color:${scoreColor};font-size:11px;font-weight:700;text-align:center;line-height:20px;margin-right:10px;">${i + 1}</span>
        <strong style="color:#fff;font-size:14px;">${p.guide?.title ?? p.type ?? 'Issue'}</strong>
        <br/>
        <span style="color:#6b7280;font-size:12px;margin-left:30px;">${p.guide?.difficulty === 'easy' ? '⚡ Easy fix · ' : p.guide?.difficulty === 'medium' ? '🔧 Medium · ' : '⚒️ Advanced · '}${p.guide?.timeEstimate ?? '30 min'}</span>
      </td>
    </tr>
  `
  ).join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Weekly SEO Digest</title>
</head>
<body style="margin:0;padding:0;background:#070d1a;font-family:'DM Sans',system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <div style="margin-bottom:24px;">
      <p style="color:#10b981;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;">Weekly SEO Digest</p>
      <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0;letter-spacing:-0.02em;">
        ${orgName ? `Hey ${orgName.split(' ')[0]}` : 'Your weekly update'} 👋
      </h1>
      <p style="color:#6b7280;font-size:15px;margin:8px 0 0;">${domain} · ${new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>

    <div style="background:#0d1626;border:1px solid #1a2235;border-radius:16px;padding:24px;margin-bottom:20px;">
      <p style="color:#6b7280;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">YOUR SEO SCORE</p>
      <div style="display:flex;align-items:center;gap:20px;">
        <div style="text-align:center;">
          <div style="font-size:64px;font-weight:900;color:${scoreColor};line-height:1;">${score}</div>
          <div style="display:inline-block;background:${scoreColor}18;color:${scoreColor};border:1px solid ${scoreColor}30;border-radius:20px;padding:2px 12px;font-size:12px;font-weight:700;margin-top:4px;">Grade ${grade} · ${label}</div>
        </div>
        <div style="flex:1;">
          ${trend ? `<p style="color:#6b7280;font-size:13px;margin:0 0 8px;">${trend}</p>` : ''}
          <div style="background:#1a2235;border-radius:6px;height:8px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,${scoreColor}80,${scoreColor});height:100%;width:${score}%;border-radius:6px;"></div>
          </div>
        </div>
      </div>
    </div>

    ${
      topPriorities.length > 0
        ? `
    <div style="background:#0d1626;border:1px solid #1a2235;border-radius:16px;overflow:hidden;margin-bottom:20px;">
      <div style="padding:16px 16px 12px;border-bottom:1px solid #1a2235;">
        <p style="color:#fff;font-size:16px;font-weight:700;margin:0;">Your top priorities this week</p>
        <p style="color:#6b7280;font-size:13px;margin:4px 0 0;">Fix these first — biggest impact</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${priorityRows}
      </table>
      <div style="padding:12px 16px;">
        <a href="${dashboardUrl}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
          View fixes in dashboard →
        </a>
      </div>
    </div>
    `
        : `
    <div style="background:#0d1626;border:1px solid #10b98130;border-radius:16px;padding:24px;margin-bottom:20px;text-align:center;">
      <p style="font-size:32px;margin:0 0 8px;">🎉</p>
      <p style="color:#fff;font-size:16px;font-weight:700;margin:0;">No critical issues this week!</p>
      <p style="color:#6b7280;font-size:13px;margin:8px 0 0;">Your site looks healthy. Keep it up.</p>
    </div>
    `
    }

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
      <div style="background:#0d1626;border:1px solid #1a2235;border-radius:12px;padding:16px;">
        <p style="color:#6b7280;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 6px;">MONITOR ALERTS</p>
        <p style="color:${changeCount > 0 ? '#f59e0b' : '#fff'};font-size:28px;font-weight:800;margin:0;">${changeCount}</p>
        <p style="color:#6b7280;font-size:12px;margin:4px 0 0;">${changeCount > 0 ? 'page changes detected' : 'no changes detected'}</p>
      </div>
      <div style="background:#0d1626;border:1px solid #1a2235;border-radius:12px;padding:16px;">
        <p style="color:#6b7280;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 6px;">CREDITS LEFT</p>
        <p style="color:#fff;font-size:28px;font-weight:800;margin:0;">${creditsRemaining}</p>
        <p style="color:#6b7280;font-size:12px;margin:4px 0 0;">this month</p>
      </div>
    </div>

    <div style="text-align:center;margin-bottom:24px;">
      <a href="${dashboardUrl}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;border-radius:12px;padding:14px 32px;font-size:15px;font-weight:700;box-shadow:0 4px 20px rgba(16,185,129,0.3);">
        Open my dashboard
      </a>
    </div>

    <div style="border-top:1px solid #1a2235;padding-top:20px;text-align:center;">
      <p style="color:#374151;font-size:12px;margin:0;">
        SEO Agent · Weekly digest
        <a href="${dashboardUrl}/dashboard/settings" style="color:#10b981;text-decoration:none;"> Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`;

  const text = `
Weekly SEO Digest — ${domain}

Your SEO Score: ${score}/100 (Grade ${grade} · ${label})
${trend ? trend : ''}

TOP PRIORITIES:
${topPriorities.slice(0, 3).map((p, i) => `${i + 1}. ${p.guide?.title ?? p.type ?? 'Issue'}`).join('\n') || 'None'}

Monitor alerts: ${changeCount} change(s) detected
Credits remaining: ${creditsRemaining}

View dashboard: ${dashboardUrl}/dashboard
`;

  return { html, text };
}

async function runWeeklyDigest() {
  console.log('[digest] Starting weekly digest run…');

  const orgs = await prisma.organization
    .findMany({
      where: {
        plan: { not: 'FREE' },
        users: { some: { email: { not: null } } },
      },
      include: {
        users: { select: { email: true, name: true }, take: 1 },
        auditRuns: {
          orderBy: { startedAt: 'desc' },
          take: 2,
          select: { id: true, summary: true, issuesFound: true, startedAt: true },
        },
        monitoredUrls: {
          select: { id: true },
        },
      },
    })
    .catch(() => []);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  let sent = 0;
  let failed = 0;

  for (const org of orgs) {
    const user = org.users[0];
    if (!user?.email) continue;

    try {
      const [latestAudit, previousAudit] = org.auditRuns;
      const score = deriveScore(latestAudit);
      const previousScore = previousAudit ? deriveScore(previousAudit) : null;

      const limit = PLAN_LIMITS[org.plan]?.creditsPerMonth ?? 100;
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const used = await prisma.usageLog.aggregate({
        where: { orgId: org.id, createdAt: { gte: startOfMonth } },
        _sum: { credits: true },
      });
      const creditsRemaining = Math.max(0, limit - (used._sum.credits ?? 0));

      const monitoredIds = org.monitoredUrls.map((u) => u.id);
      const changeCount =
        monitoredIds.length > 0
          ? await prisma.changeEvent.count({
              where: {
                monitoredUrlId: { in: monitoredIds },
                detectedAt: { gte: weekAgo },
                changeStatus: { in: ['new', 'changed'] },
              },
            })
          : 0;

      const topPriorities = [];
      if (latestAudit) {
        const pages = await prisma.auditPage.findMany({
          where: { auditRunId: latestAudit.id },
          select: { issues: true },
        });
        const issues = pages.flatMap((p) => (Array.isArray(p.issues) ? p.issues : []));
        const bySeverity = { critical: 3, warning: 2, info: 1 };
        issues
          .sort((a, b) => (bySeverity[b.severity] ?? 0) - (bySeverity[a.severity] ?? 0))
          .slice(0, 5)
          .forEach((i) => {
            topPriorities.push({
              type: i.type || i.severity || 'issue',
              guide: {
                title: i.message || i.type || 'Fix issue',
                difficulty: i.severity === 'critical' ? 'easy' : i.severity === 'warning' ? 'medium' : 'advanced',
                timeEstimate: '15–30 min',
              },
            });
          });
      }

      const { html, text } = buildDigestEmail({
        orgName: user.name ?? org.name,
        domain: org.domain,
        score,
        previousScore,
        topPriorities,
        changeCount,
        creditsRemaining,
      });

      await sendEmail({
        to: user.email,
        subject: `Your SEO score this week: ${score}/100 ${score >= 80 ? '🟢' : score >= 50 ? '🟡' : '🔴'} — ${org.domain}`,
        html,
        text,
      });

      sent++;
      console.log(`[digest] ✓ Sent to ${user.email} (score: ${score})`);
    } catch (err) {
      failed++;
      console.error(`[digest] ✗ Failed for org ${org.id}:`, err.message);
    }
  }

  console.log(`[digest] Done. Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed };
}

module.exports = { runWeeklyDigest, sendEmail, buildDigestEmail };
