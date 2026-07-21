import type { ResolvedScenario, ScenarioSubscription } from './scenario'

export function isEntitledSubscription(subscription: ScenarioSubscription): boolean {
  return subscription.status === 'active' || subscription.status === 'past_due'
}

export function sameBillingReference(
  left: ScenarioSubscription,
  right: ScenarioSubscription
): boolean {
  return billingReferenceKey(left) === billingReferenceKey(right)
}

export function initialSubscriptionStatus(
  scenario: ResolvedScenario,
  definition: ScenarioSubscription
): 'active' | 'past_due' | 'canceled' {
  if (definition.status !== 'lapsed') return definition.status
  const hasEntitledReplacement = scenario.definition.subscriptions.some(
    (candidate) =>
      candidate.key !== definition.key &&
      isEntitledSubscription(candidate) &&
      sameBillingReference(candidate, definition)
  )
  return hasEntitledReplacement ? 'canceled' : 'active'
}

export function expectedUsageLimit(scenario: ResolvedScenario, userKey: string): string | null {
  const organizationKeys = new Set(
    scenario.definition.organizationMemberships
      .filter((membership) => membership.userKey === userKey)
      .map((membership) => membership.organizationKey)
  )
  const hasEntitledOrganizationSubscription = scenario.definition.subscriptions.some(
    (candidate) =>
      candidate.billingReference.kind === 'organization' &&
      organizationKeys.has(candidate.billingReference.organizationKey) &&
      isEntitledSubscription(candidate)
  )
  if (hasEntitledOrganizationSubscription) return null

  const personalSubscription = scenario.definition.subscriptions.find(
    (candidate) =>
      candidate.billingReference.kind === 'user' &&
      candidate.billingReference.userKey === userKey &&
      isEntitledSubscription(candidate)
  )
  if (personalSubscription?.plan.startsWith('pro_')) {
    return String(Number(personalSubscription.plan.split('_')[1]) / 200)
  }
  return '5'
}

export function billingReferenceKey(subscription: ScenarioSubscription): string {
  return subscription.billingReference.kind === 'user'
    ? `user/${subscription.billingReference.userKey}`
    : `organization/${subscription.billingReference.organizationKey}`
}
