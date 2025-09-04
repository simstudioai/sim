import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { DEFAULT_FREE_CREDITS } from '@/lib/billing/constants'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  BillingStatus,
  SubscriptionData,
  SubscriptionFeatures,
  SubscriptionStore,
  UsageData,
  UsageLimitData,
} from '@/stores/subscription/types'

const logger = createLogger('SubscriptionStore')

const CACHE_DURATION = 30 * 1000

const defaultFeatures: SubscriptionFeatures = {
  sharingEnabled: false,
  multiplayerEnabled: false,
  workspaceCollaborationEnabled: false,
}

const defaultUsage: UsageData = {
  current: 0,
  limit: DEFAULT_FREE_CREDITS,
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
          return state.subscriptionData
        }

        // Don't start multiple concurrent requests
        if (state.isLoading) {
          logger.debug('Subscription data already loading, skipping duplicate request')
          return get().subscriptionData
        }

        set({ isLoading: true, error: null })

        try {
          const response = await fetch('/api/billing?context=user')

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const result = await response.json()
          const data = result.data

          // Transform dates with error handling
          const transformedData: SubscriptionData = {
            ...data,
            periodEnd: data.periodEnd
              ? (() => {
                  try {
                    const date = new Date(data.periodEnd)
                    return Number.isNaN(date.getTime()) ? null : date
                  } catch {
                    return null
                  }
                })()
              : null,
            usage: {
              ...data.usage,
              billingPeriodStart: data.usage?.billingPeriodStart
                ? (() => {
                    try {
                      const date = new Date(data.usage.billingPeriodStart)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
                : null,
              billingPeriodEnd: data.usage?.billingPeriodEnd
                ? (() => {
                    try {
                      const date = new Date(data.usage.billingPeriodEnd)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
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
          return transformedData
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load subscription data'
          logger.error('Failed to load subscription data', { error })

          set({
            isLoading: false,
            error: errorMessage,
          })
          return null
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
          return transformedData
        } catch (error) {
          logger.error('Failed to load usage limit data', { error })
          // Don't set error state for usage limit failures - subscription data is more critical
          return null
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

          // Refresh the store state to ensure consistency
          await get().refresh()

          logger.debug('Usage limit updated successfully', { newLimit })
          return { success: true }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to update usage limit'
          logger.error('Failed to update usage limit', { error, newLimit })
          return { success: false, error: errorMessage }
        }
      },

      cancelSubscription: async () => {
        const state = get()
        if (!state.subscriptionData) {
          logger.error('No subscription data available for cancellation')
          return { success: false, error: 'No subscription data available' }
        }

        set({ isLoading: true, error: null })

        try {
          const response = await fetch('/api/users/me/subscription/cancel', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to cancel subscription')
          }

          const result = await response.json()

          logger.info('Subscription cancelled successfully', {
            periodEnd: result.data.periodEnd,
            cancelAtPeriodEnd: result.data.cancelAtPeriodEnd,
          })

          // Refresh subscription data to reflect cancellation status
          await get().refresh()

          return {
            success: true,
            periodEnd: result.data.periodEnd ? new Date(result.data.periodEnd) : undefined,
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to cancel subscription'
          logger.error('Failed to cancel subscription', { error })
          set({ error: errorMessage })
          return { success: false, error: errorMessage }
        } finally {
          set({ isLoading: false })
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
            const usageLimitData = await get().loadUsageLimitData()
            return {
              subscriptionData: state.subscriptionData,
              usageLimitData: usageLimitData,
            }
          }
          return {
            subscriptionData: state.subscriptionData,
            usageLimitData: state.usageLimitData,
          }
        }

        // Don't start multiple concurrent requests
        if (state.isLoading) {
          logger.debug('Data already loading, skipping duplicate request')
          return {
            subscriptionData: get().subscriptionData,
            usageLimitData: get().usageLimitData,
          }
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

          // Transform subscription data dates with error handling
          const transformedSubscriptionData: SubscriptionData = {
            ...subscriptionData,
            periodEnd: subscriptionData.periodEnd
              ? (() => {
                  try {
                    const date = new Date(subscriptionData.periodEnd)
                    return Number.isNaN(date.getTime()) ? null : date
                  } catch {
                    return null
                  }
                })()
              : null,
            usage: {
              ...subscriptionData.usage,
              billingPeriodStart: subscriptionData.usage?.billingPeriodStart
                ? (() => {
                    try {
                      const date = new Date(subscriptionData.usage.billingPeriodStart)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
                : null,
              billingPeriodEnd: subscriptionData.usage?.billingPeriodEnd
                ? (() => {
                    try {
                      const date = new Date(subscriptionData.usage.billingPeriodEnd)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
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
          return {
            subscriptionData: transformedSubscriptionData,
            usageLimitData: transformedUsageLimitData,
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load data'
          logger.error('Failed to load data', { error })

          set({
            isLoading: false,
            error: errorMessage,
          })
          return {
            subscriptionData: null,
            usageLimitData: null,
          }
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
