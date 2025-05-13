/**
 * Determine if a subscription is an enterprise plan
 * Use this as a single source of truth for enterprise subscription detection
 */
export function checkEnterprisePlan(subscription: any): boolean {
  return subscription?.plan === 'enterprise' && subscription?.status === 'active'
}

/**
 * Calculate usage limit for a subscription based on its type and metadata
 * @param subscription The subscription object
 * @returns The calculated usage limit in dollars
 */
export function calculateUsageLimit(subscription: any): number {
  if (!subscription || subscription.status !== 'active') {
    // Default free tier limit
    return 5 // Free tier default
  }

  const seats = subscription.seats || 1

  // Check plan type and calculate accordingly
  if (subscription.plan === 'pro') {
    return 20 // Pro plan has fixed $20 limit
  } else if (subscription.plan === 'team') {
    return seats * 40 // Team plan has $40 per seat
  } else if (subscription.plan === 'enterprise') {
    // Enterprise plan has custom limits defined in metadata
    const metadata = subscription.metadata || {}

    // If per-seat allowance is defined, use that × seats
    if (metadata.perSeatAllowance) {
      return seats * parseFloat(metadata.perSeatAllowance)
    }

    // If total allowance is defined directly, use that
    if (metadata.totalAllowance) {
      return parseFloat(metadata.totalAllowance)
    }

    // Fallback enterprise allowance
    return seats * 100 // Default to $100 per seat for enterprise if not specified
  }

  // Fallback to free tier
  return 5
}
