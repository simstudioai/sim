import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import type {
  BillingStatus,
  SubscriptionData,
  SubscriptionFeatures,
  SubscriptionStore,
  UsageData,
  UsageLimitData,
} from './types'

const logger = createLogger('SubscriptionStore')

const CACHE_DURATION = 30 * 1000

const defaultFeatures: SubscriptionFeatures = {
  sharingEnabled: false,
  multiplayerEnabled: false,
  workspaceCollaborationEnabled: false,
}

const defaultUsage: UsageData = {
  current: 0,
  limit: 5,
  percentUsed: 0,
  isWarning: false,
  isExceeded: false,
  billingPeriodStart: null,
  billingPeriodEnd: null,
  lastPeriodCost: 0,
}

export const useSubscriptionStore = create<SubscriptionStore>()(
  devtools(
    (set, get) => ({
      // State
      subscriptionData: null,
      usageLimitData: null,
      isLoading: false,
      error: null,
      lastFetched: null,

      // Core actions
      loadSubscriptionData: async () => {
        const state = get()

        // Check cache validity
        if (
          state.subscriptionData &&
          state.lastFetched &&
          Date.now() - state.lastFetched < CACHE_DURATION
        ) {
          logger.debug('Using cached subscription data')
          return
        }

        // Don't start multiple concurrent requests
        if (state.isLoading) {
          logger.debug('Subscription data already loading, skipping duplicate request')
          return
        }

        set({ isLoading: true, error: null })

        try {
          const response = await fetch('/api/billing?context=user')

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const result = await response.json()
          const data = result.data

          // Transform dates
          const transformedData: SubscriptionData = {
            ...data,
            usage: {
              ...data.usage,
              billingPeriodStart: data.usage?.billingPeriodStart
                ? new Date(data.usage.billingPeriodStart)
                : null,
              billingPeriodEnd: data.usage?.billingPeriodEnd
                ? new Date(data.usage.billingPeriodEnd)
                : null,
            },
          }

          // Debug logging for billing periods
          logger.debug('Billing period data', {
            raw: {
              billingPeriodStart: data.usage?.billingPeriodStart,
              billingPeriodEnd: data.usage?.billingPeriodEnd,
            },
            transformed: {
              billingPeriodStart: transformedData.usage.billingPeriodStart,
              billingPeriodEnd: transformedData.usage.billingPeriodEnd,
            },
          })

          set({
            subscriptionData: transformedData,
            isLoading: false,
            error: null,
            lastFetched: Date.now(),
          })

          logger.debug('Subscription data loaded successfully')
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load subscription data'
          logger.error('Failed to load subscription data', { error })

          set({
            isLoading: false,
            error: errorMessage,
          })
        }
      },

      loadUsageLimitData: async () => {
        try {
          const response = await fetch('/api/usage-limits?context=user')

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const data = await response.json()

          // Transform dates
          const transformedData: UsageLimitData = {
            ...data,
            updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
          }

          set({ usageLimitData: transformedData })
          logger.debug('Usage limit data loaded successfully')
        } catch (error) {
          logger.error('Failed to load usage limit data', { error })
          // Don't set error state for usage limit failures - subscription data is more critical
        }
      },

      updateUsageLimit: async (newLimit: number) => {
        try {
          const response = await fetch('/api/usage-limits?context=user', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ limit: newLimit }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to update usage limit')
          }

          // Simple state update - just update the usage limit data
          const currentState = get()
          if (currentState.usageLimitData) {
            set({
              usageLimitData: {
                ...currentState.usageLimitData,
                currentLimit: newLimit,
              },
            })
          }

          // Trigger a background refresh without waiting
          setTimeout(() => {
            get().refresh()
          }, 100)

          logger.debug('Usage limit updated successfully', { newLimit })
          return { success: true }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to update usage limit'
          logger.error('Failed to update usage limit', { error, newLimit })
          return { success: false, error: errorMessage }
        }
      },

      refresh: async () => {
        // Force refresh by clearing cache
        set({ lastFetched: null })
        await get().loadData()
      },

      // Load both subscription and usage limit data in parallel
      loadData: async () => {
        const state = get()

        // Check cache validity for subscription data
        if (
          state.subscriptionData &&
          state.lastFetched &&
          Date.now() - state.lastFetched < CACHE_DURATION
        ) {
          logger.debug('Using cached data')
          // Still load usage limit if not present
          if (!state.usageLimitData) {
            await get().loadUsageLimitData()
          }
          return
        }

        // Don't start multiple concurrent requests
        if (state.isLoading) {
          logger.debug('Data already loading, skipping duplicate request')
          return
        }

        set({ isLoading: true, error: null })

        try {
          // Load both subscription and usage limit data in parallel
          const [subscriptionResponse, usageLimitResponse] = await Promise.all([
            fetch('/api/billing?context=user'),
            fetch('/api/usage-limits?context=user'),
          ])

          if (!subscriptionResponse.ok) {
            throw new Error(`HTTP error! status: ${subscriptionResponse.status}`)
          }

          const subscriptionResult = await subscriptionResponse.json()
          const subscriptionData = subscriptionResult.data
          let usageLimitData = null

          if (usageLimitResponse.ok) {
            usageLimitData = await usageLimitResponse.json()
          } else {
            logger.warn('Failed to load usage limit data, using defaults')
          }

          // Transform subscription data dates
          const transformedSubscriptionData: SubscriptionData = {
            ...subscriptionData,
            usage: {
              ...subscriptionData.usage,
              billingPeriodStart: subscriptionData.usage?.billingPeriodStart
                ? new Date(subscriptionData.usage.billingPeriodStart)
                : null,
              billingPeriodEnd: subscriptionData.usage?.billingPeriodEnd
                ? new Date(subscriptionData.usage.billingPeriodEnd)
                : null,
            },
          }

          // Debug logging for parallel billing periods
          logger.debug('Parallel billing period data', {
            raw: {
              billingPeriodStart: subscriptionData.usage?.billingPeriodStart,
              billingPeriodEnd: subscriptionData.usage?.billingPeriodEnd,
            },
            transformed: {
              billingPeriodStart: transformedSubscriptionData.usage.billingPeriodStart,
              billingPeriodEnd: transformedSubscriptionData.usage.billingPeriodEnd,
            },
          })

          // Transform usage limit data dates if present
          const transformedUsageLimitData: UsageLimitData | null = usageLimitData
            ? {
                ...usageLimitData,
                updatedAt: usageLimitData.updatedAt
                  ? new Date(usageLimitData.updatedAt)
                  : undefined,
              }
            : null

          set({
            subscriptionData: transformedSubscriptionData,
            usageLimitData: transformedUsageLimitData,
            isLoading: false,
            error: null,
            lastFetched: Date.now(),
          })

          logger.debug('Data loaded successfully in parallel')
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load data'
          logger.error('Failed to load data', { error })

          set({
            isLoading: false,
            error: errorMessage,
          })
        }
      },

      clearError: () => {
        set({ error: null })
      },

      reset: () => {
        set({
          subscriptionData: null,
          usageLimitData: null,
          isLoading: false,
          error: null,
          lastFetched: null,
        })
      },

      // Computed getters
      getSubscriptionStatus: () => {
        const data = get().subscriptionData
        return {
          isPaid: data?.isPaid ?? false,
          isPro: data?.isPro ?? false,
          isTeam: data?.isTeam ?? false,
          isEnterprise: data?.isEnterprise ?? false,
          isFree: !(data?.isPaid ?? false),
          plan: data?.plan ?? 'free',
          status: data?.status ?? null,
          seats: data?.seats ?? null,
          metadata: data?.metadata ?? null,
        }
      },

      getFeatures: () => {
        return get().subscriptionData?.features ?? defaultFeatures
      },

      getUsage: () => {
        return get().subscriptionData?.usage ?? defaultUsage
      },

      getBillingStatus: (): BillingStatus => {
        const usage = get().getUsage()
        if (usage.isExceeded) return 'exceeded'
        if (usage.isWarning) return 'warning'
        return 'ok'
      },

      getRemainingBudget: () => {
        const usage = get().getUsage()
        return Math.max(0, usage.limit - usage.current)
      },

      getDaysRemainingInPeriod: () => {
        const usage = get().getUsage()
        if (!usage.billingPeriodEnd) return null

        const now = new Date()
        const endDate = usage.billingPeriodEnd
        const diffTime = endDate.getTime() - now.getTime()
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

        return Math.max(0, diffDays)
      },

      hasFeature: (feature: keyof SubscriptionFeatures) => {
        return get().getFeatures()[feature] ?? false
      },

      isAtLeastPro: () => {
        const status = get().getSubscriptionStatus()
        return status.isPro || status.isTeam || status.isEnterprise
      },

      isAtLeastTeam: () => {
        const status = get().getSubscriptionStatus()
        return status.isTeam || status.isEnterprise
      },

      canUpgrade: () => {
        const status = get().getSubscriptionStatus()
        return status.plan === 'free' || status.plan === 'pro'
      },
    }),
    { name: 'subscription-store' }
  )
)

// Auto-load subscription data when store is first accessed
if (typeof window !== 'undefined') {
  // Load data in parallel on store creation
  useSubscriptionStore.getState().loadData()
}
