export interface SubscriptionFeatures {
  sharingEnabled: boolean
  multiplayerEnabled: boolean
  workspaceCollaborationEnabled: boolean
}

export interface UsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
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
  features: SubscriptionFeatures
  usage: UsageData
}

export type BillingStatus = 'unknown' | 'ok' | 'warning' | 'exceeded'

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
  cancelSubscription: () => Promise<{ success: boolean; error?: string; periodEnd?: Date }>
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
  getFeatures: () => SubscriptionFeatures
  getUsage: () => UsageData
  getBillingStatus: () => BillingStatus
  getRemainingBudget: () => number
  getDaysRemainingInPeriod: () => number | null
  hasFeature: (feature: keyof SubscriptionFeatures) => boolean
  isAtLeastPro: () => boolean
  isAtLeastTeam: () => boolean
  canUpgrade: () => boolean
}
