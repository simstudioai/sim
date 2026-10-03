export interface UsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | string | null
  billingPeriodEnd: Date | string | null
  lastPeriodCost: number
  lastPeriodCopilotCost?: number
  copilotCost?: number
}

export interface SubscriptionData {
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  /** True when the subscription's `referenceId` is an organization. */
  isOrgScoped: boolean
  organizationId: string | null
  plan: string
  status: string | null
  seats: number | null
  metadata: any | null
  stripeSubscriptionId: string | null
  periodEnd: Date | string | null
  cancelAtPeriodEnd?: boolean
  usage: UsageData
  billingBlocked?: boolean
}

export type BillingStatus = 'unknown' | 'ok' | 'warning' | 'exceeded' | 'blocked'
