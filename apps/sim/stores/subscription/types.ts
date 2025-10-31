export interface UsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
  lastPeriodCopilotCost?: number
  copilotCost?: number
}

export interface UsageLimitData {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  plan: string
  setBy?: string
  updatedAt?: Date
}

export interface SubscriptionData {
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  plan: string
  status: string | null
  seats: number | null
  metadata: any | null
  stripeSubscriptionId: string | null
  periodEnd: Date | null
  cancelAtPeriodEnd?: boolean
  usage: UsageData
  billingBlocked?: boolean
}

export type BillingStatus = 'unknown' | 'ok' | 'warning' | 'exceeded' | 'blocked'

export interface SubscriptionStore {
  subscriptionData: SubscriptionData | null
  usageLimitData: UsageLimitData | null
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  loadSubscriptionData: () => Promise<SubscriptionData | null>
  loadUsageLimitData: () => Promise<UsageLimitData | null>
  loadData: () => Promise<{
    subscriptionData: SubscriptionData | null
    usageLimitData: UsageLimitData | null
  }>
  updateUsageLimit: (newLimit: number) => Promise<{ success: boolean; error?: string }>
  refresh: () => Promise<void>
  clearError: () => void
  reset: () => void
  getSubscriptionStatus: () => {
    isPaid: boolean
    isPro: boolean
    isTeam: boolean
    isEnterprise: boolean
    isFree: boolean
    plan: string
    status: string | null
    seats: number | null
    metadata: any | null
  }
  getUsage: () => UsageData
  getBillingStatus: () => BillingStatus
  getRemainingBudget: () => number
  getDaysRemainingInPeriod: () => number | null
  isAtLeastPro: () => boolean
  isAtLeastTeam: () => boolean
  canUpgrade: () => boolean
}
