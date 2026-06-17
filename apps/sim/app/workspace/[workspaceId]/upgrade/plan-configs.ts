/**
 * Config for a plan's top-level credit stats.
 * When `credits` is omitted the credits/refresh block is not rendered.
 */
export interface PlanCredits {
  /** Formatted credits string, e.g. `"6,000 credits/mo"`. */
  credits: string
  /** Formatted daily-refresh string, e.g. `"+50/day refresh"`. */
  refresh: string
}

export const PRO_PLAN_CREDITS: PlanCredits = {
  credits: '6,000 credits/mo',
  refresh: '+50/day refresh',
}

export const MAX_PLAN_CREDITS: PlanCredits = {
  credits: '25,000 credits/mo',
  refresh: '+200/day refresh',
}

export const ENTERPRISE_PLAN_CREDITS: PlanCredits = {
  credits: 'Custom',
  refresh: 'Custom',
}

export const PRO_PLAN_FEATURES: readonly string[] = [
  'Invite teammates',
  'Deploy workflows as APIs',
  'Extended run timeouts',
  'More storage & tables',
]

export const MAX_PLAN_FEATURES: readonly string[] = [
  'Invite teammates',
  'Sim Mailer & KB Live Sync',
  'Highest rate limits',
  'Expanded storage & tables',
]

export const ENTERPRISE_PLAN_FEATURES: readonly string[] = [
  'Custom limits & infrastructure',
  'SSO & SOC2 compliance',
  'Access control & self-hosting',
  'Dedicated support',
]
