import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_FREE_CREDITS } from '@/lib/billing/constants'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useSubscriptionState')

interface UsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
}

interface SubscriptionState {
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  plan: string
  status: string | null
  seats: number | null
  metadata: any | null
  usage: UsageData
}

/**
 * Consolidated hook for subscription state management
 * Combines subscription status, features, and usage data
 */
export function useSubscriptionState() {
  const [data, setData] = useState<SubscriptionState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchSubscriptionState = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/billing?context=user')

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      const subscriptionData = result.data
      setData(subscriptionData)
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to fetch subscription state')
      logger.error('Failed to fetch subscription state', { error })
      setError(err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSubscriptionState()
  }, [fetchSubscriptionState])

  const refetch = useCallback(() => {
    return fetchSubscriptionState()
  }, [fetchSubscriptionState])

  return {
    subscription: {
      isPaid: data?.isPaid ?? false,
      isPro: data?.isPro ?? false,
      isTeam: data?.isTeam ?? false,
      isEnterprise: data?.isEnterprise ?? false,
      isFree: !(data?.isPaid ?? false),
      plan: data?.plan ?? 'free',
      status: data?.status,
      seats: data?.seats,
      metadata: data?.metadata,
    },

    usage: {
      current: data?.usage?.current ?? 0,
      limit: data?.usage?.limit ?? DEFAULT_FREE_CREDITS,
      percentUsed: data?.usage?.percentUsed ?? 0,
      isWarning: data?.usage?.isWarning ?? false,
      isExceeded: data?.usage?.isExceeded ?? false,
      billingPeriodStart: data?.usage?.billingPeriodStart
        ? new Date(data.usage.billingPeriodStart)
        : null,
      billingPeriodEnd: data?.usage?.billingPeriodEnd
        ? new Date(data.usage.billingPeriodEnd)
        : null,
      lastPeriodCost: data?.usage?.lastPeriodCost ?? 0,
    },

    isLoading,
    error,
    refetch,

    isAtLeastPro: () => {
      return data?.isPro || data?.isTeam || data?.isEnterprise || false
    },

    isAtLeastTeam: () => {
      return data?.isTeam || data?.isEnterprise || false
    },

    canUpgrade: () => {
      return data?.plan === 'free' || data?.plan === 'pro'
    },

    getBillingStatus: () => {
      const usage = data?.usage
      if (!usage) return 'unknown'

      if (usage.isExceeded) return 'exceeded'
      if (usage.isWarning) return 'warning'
      return 'ok'
    },

    getRemainingBudget: () => {
      const usage = data?.usage
      if (!usage) return 0
      return Math.max(0, usage.limit - usage.current)
    },

    getDaysRemainingInPeriod: () => {
      const usage = data?.usage
      if (!usage?.billingPeriodEnd) return null

      const now = new Date()
      const endDate = new Date(usage.billingPeriodEnd)
      const diffTime = endDate.getTime() - now.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      return Math.max(0, diffDays)
    },
  }
}

/**
 * Hook for usage limit information with editing capabilities
 */
export function useUsageLimit() {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchUsageLimit = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/usage?context=user')

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const limitData = await response.json()
      setData(limitData)
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to fetch usage limit')
      logger.error('Failed to fetch usage limit', { error })
      setError(err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsageLimit()
  }, [fetchUsageLimit])

  const refetch = useCallback(() => {
    return fetchUsageLimit()
  }, [fetchUsageLimit])

  const updateLimit = async (newLimit: number) => {
    try {
      const response = await fetch('/api/usage?context=user', {
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

      await refetch()

      return { success: true }
    } catch (error) {
      logger.error('Failed to update usage limit', { error, newLimit })
      throw error
    }
  }

  return {
    currentLimit: data?.currentLimit ?? DEFAULT_FREE_CREDITS,
    canEdit: data?.canEdit ?? false,
    minimumLimit: data?.minimumLimit ?? DEFAULT_FREE_CREDITS,
    plan: data?.plan ?? 'free',
    setBy: data?.setBy,
    updatedAt: data?.updatedAt ? new Date(data.updatedAt) : null,
    updateLimit,
    isLoading,
    error,
    refetch,
  }
}
