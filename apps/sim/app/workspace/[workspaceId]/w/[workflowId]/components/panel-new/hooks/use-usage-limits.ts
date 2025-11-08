import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useSubscriptionStore } from '@/stores/subscription/store'
import type { UsageData as StoreUsageData } from '@/stores/subscription/types'

const logger = createLogger('useUsageLimits')

/**
 * Extended usage data structure that combines API response and store data.
 * Supports both 'current' (from store) and 'currentUsage' (from API) for compatibility.
 */
export interface UsageData {
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  current: number
  currentUsage: number
  limit: number
}

/**
 * Normalizes usage data to ensure both 'current' and 'currentUsage' fields exist
 */
function normalizeUsageData(data: StoreUsageData | any): UsageData {
  return {
    percentUsed: data.percentUsed,
    isWarning: data.isWarning,
    isExceeded: data.isExceeded,
    current: data.current ?? data.currentUsage ?? 0,
    currentUsage: data.currentUsage ?? data.current ?? 0,
    limit: data.limit,
  }
}

/**
 * Cache for usage data to prevent excessive API calls
 */
let usageDataCache: {
  data: UsageData | null
  timestamp: number
  expirationMs: number
} = {
  data: null,
  timestamp: 0,
  expirationMs: 60 * 1000, // Cache expires after 1 minute
}

/**
 * Custom hook to manage usage limits with caching and automatic refresh.
 * Provides usage data, exceeded status, and methods to check, refresh, and update limits.
 *
 * Features:
 * - Automatic caching with 60-second expiration
 * - Fallback to subscription store if API unavailable
 * - Auto-refresh on mount
 * - Manual refresh capability
 * - Update limit functionality (for user and organization contexts)
 * - Integration with usage-limit.tsx component
 *
 * @param options - Configuration options
 * @param options.context - Context for usage check ('user' or 'organization')
 * @param options.organizationId - Required when context is 'organization'
 * @param options.autoRefresh - Whether to automatically check on mount (default: true)
 * @returns Usage state and helper methods
 */
export function useUsageLimits(options?: {
  context?: 'user' | 'organization'
  organizationId?: string
  autoRefresh?: boolean
}) {
  const { context = 'user', organizationId, autoRefresh = true } = options || {}

  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [usageExceeded, setUsageExceeded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  /**
   * Check user/organization usage limits with caching
   */
  const checkUsage = useCallback(
    async (forceRefresh = false): Promise<UsageData | null> => {
      const now = Date.now()
      const cacheAge = now - usageDataCache.timestamp

      // Return cached data if still valid and not forcing refresh
      if (!forceRefresh && usageDataCache.data && cacheAge < usageDataCache.expirationMs) {
        logger.info('Using cached usage data', {
          cacheAge: `${Math.round(cacheAge / 1000)}s`,
        })
        return usageDataCache.data
      }

      setIsLoading(true)
      setError(null)

      try {
        // Build query params
        const params = new URLSearchParams({ context })
        if (context === 'organization' && organizationId) {
          params.append('organizationId', organizationId)
        }

        // Primary: call server-side usage check to mirror backend enforcement
        const res = await fetch(`/api/usage?${params.toString()}`, { cache: 'no-store' })
        if (res.ok) {
          const payload = await res.json()
          const usage = normalizeUsageData(payload?.data)

          // Update cache
          usageDataCache = {
            data: usage,
            timestamp: now,
            expirationMs: usageDataCache.expirationMs,
          }

          setUsageData(usage)
          setUsageExceeded(usage?.isExceeded || false)
          return usage
        }

        // Fallback: use store if API not available (user context only)
        if (context === 'user') {
          const { getUsage, refresh } = useSubscriptionStore.getState()
          if (forceRefresh) await refresh()
          const storeUsage = getUsage()
          const usage = normalizeUsageData(storeUsage)

          // Update cache
          usageDataCache = {
            data: usage,
            timestamp: now,
            expirationMs: usageDataCache.expirationMs,
          }

          setUsageData(usage)
          setUsageExceeded(usage?.isExceeded || false)
          return usage
        }

        throw new Error('Failed to fetch usage data')
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to check usage limits')
        logger.error('Error checking usage limits:', { error })
        setError(error)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [context, organizationId]
  )

  /**
   * Update usage limit for user or organization
   */
  const updateLimit = useCallback(
    async (newLimit: number): Promise<{ success: boolean; error?: string }> => {
      setIsUpdating(true)
      setError(null)

      try {
        if (context === 'organization') {
          if (!organizationId) {
            throw new Error('Organization ID is required')
          }

          const response = await fetch('/api/usage', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ context: 'organization', organizationId, limit: newLimit }),
          })

          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || 'Failed to update limit')
          }

          // Clear cache and refresh
          clearCache()
          await checkUsage(true)

          return { success: true }
        }

        // User context
        const { updateUsageLimit } = useSubscriptionStore.getState()
        const result = await updateUsageLimit(newLimit)

        if (!result.success) {
          throw new Error(result.error || 'Failed to update limit')
        }

        // Clear cache and refresh
        clearCache()
        await checkUsage(true)

        return { success: true }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to update usage limit'
        logger.error('Failed to update usage limit', { error: err })
        setError(err instanceof Error ? err : new Error(errorMessage))
        return { success: false, error: errorMessage }
      } finally {
        setIsUpdating(false)
      }
    },
    [context, organizationId, checkUsage]
  )

  /**
   * Refresh usage data, bypassing cache
   */
  const refresh = useCallback(async () => {
    return checkUsage(true)
  }, [checkUsage])

  /**
   * Clear the cache (useful for testing or forced refresh)
   */
  const clearCache = useCallback(() => {
    usageDataCache = {
      data: null,
      timestamp: 0,
      expirationMs: usageDataCache.expirationMs,
    }
  }, [])

  /**
   * Auto-refresh on mount if enabled
   */
  useEffect(() => {
    if (autoRefresh) {
      checkUsage()
    }
  }, [autoRefresh, checkUsage])

  return {
    usageData,
    usageExceeded,
    isLoading,
    isUpdating,
    error,
    checkUsage,
    refresh,
    updateLimit,
    clearCache,
  }
}
