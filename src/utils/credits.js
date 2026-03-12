const { CREDIT_COSTS, PLAN_LIMITS } = require('./constants');
const { prisma } = require('./prisma');

/**
 * Check if org has enough credits for an operation.
 * Returns { allowed, remaining, cost } or throws 402.
 */
async function checkCredits(request, reply, operation, multiplier = 1) {
  const cost = (CREDIT_COSTS[operation] || 1) * multiplier;

  // Enterprise = unlimited
  if (request.org.plan === 'ENTERPRISE') {
    return { allowed: true, remaining: Infinity, cost };
  }

  // Get current month usage
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const used = await prisma.usageLog.aggregate({
    where: { orgId: request.org.id, createdAt: { gte: startOfMonth } },
    _sum: { credits: true }
  });

  const totalUsed = used._sum.credits || 0;
  const limit = PLAN_LIMITS[request.org.plan]?.creditsPerMonth || 100;
  const remaining = limit - totalUsed;

  if (remaining < cost) {
    reply.code(402).send({
      error: 'insufficient_credits',
      message: `This operation costs ${cost} credits. You have ${remaining} remaining.`,
      upgrade: 'POST /api/billing/upgrade',
      usage: { used: totalUsed, limit, remaining, operationCost: cost }
    });
    const err = new Error('CREDITS_EXCEEDED');
    err.replySent = true;
    throw err;
  }

  return { allowed: true, remaining: remaining - cost, cost };
}

/**
 * Record credit consumption on the request (logged by usage middleware).
 */
function consumeCredits(request, operation, credits) {
  request.creditsUsed = (request.creditsUsed || 0) + credits;
  request.operationName = operation;
}

/**
 * Check if org's plan includes a feature.
 */
function checkFeature(request, reply, feature) {
  const features = PLAN_LIMITS[request.org.plan]?.features || [];
  if (features.includes('*') || features.includes(feature)) return true;

  reply.code(403).send({
    error: 'feature_not_available',
    message: `"${feature}" requires a higher plan. Current: ${request.org.plan}`,
    upgrade: 'POST /api/billing/upgrade'
  });
  return false;
}

module.exports = { checkCredits, consumeCredits, checkFeature };
