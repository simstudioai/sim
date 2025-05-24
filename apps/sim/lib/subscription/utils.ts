export function checkEnterprisePlan(subscription: any): boolean {
  return subscription?.plan === 'enterprise' && subscription?.status === 'active'
}

export function checkProPlan(subscription: any): boolean {
  return subscription?.plan === 'pro' && subscription?.status === 'active'
}

export function checkTeamPlan(subscription: any): boolean {
  return subscription?.plan === 'team' && subscription?.status === 'active'
}

/**
 * Calculate usage limit for a subscription based on its type and metadata
 * @param subscription The subscription object
 * @returns The calculated usage limit in dollars
 */
export function calculateUsageLimit(subscription: any): number {
  if (!subscription || subscription.status !== 'active') {
    return Number.parseFloat(process.env.FREE_TIER_COST_LIMIT!)
  }

  const seats = subscription.seats || 1

  if (subscription.plan === 'pro') {
    return Number.parseFloat(process.env.PRO_TIER_COST_LIMIT!)
  }
  if (subscription.plan === 'team') {
    return seats * Number.parseFloat(process.env.TEAM_TIER_COST_LIMIT!)
  }
  if (subscription.plan === 'enterprise') {
    const metadata = subscription.metadata || {}

    if (metadata.perSeatAllowance) {
      return seats * Number.parseFloat(metadata.perSeatAllowance)
    }

    if (metadata.totalAllowance) {
      return Number.parseFloat(metadata.totalAllowance)
    }

    return seats * Number.parseFloat(process.env.ENTERPRISE_TIER_COST_LIMIT!)
  }

  return Number.parseFloat(process.env.FREE_TIER_COST_LIMIT!)
}
