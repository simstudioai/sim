import { useSubscriptionData } from '@/hooks/queries/subscription'

/**
 * Simplified hook that uses React Query for usage limits.
 * Provides usage exceeded status from existing subscription data.
 */

export function useUsageLimits(options?: {
  context?: 'user' | 'organization'
  organizationId?: string
  autoRefresh?: boolean
}) {
  // For now, we only support user context via React Query
  // Organization context should use useOrganizationBilling directly
  const { data: subscriptionData, isLoading } = useSubscriptionData()

  const usageExceeded = subscriptionData?.data?.usage?.isExceeded || false

  return {
    usageExceeded,
    isLoading,
  }
}
