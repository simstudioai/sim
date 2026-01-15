import { createLogger } from '@sim/logger'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const logger = createLogger('AdminStatusQuery')

/**
 * Query key factories for admin status
 */
export const adminStatusKeys = {
  all: ['adminStatus'] as const,
  current: () => [...adminStatusKeys.all, 'current'] as const,
}

/**
 * Admin status response type
 */
export interface AdminStatus {
  hasAdminPrivileges: boolean
  role: string | null
}

/**
 * Fetch current user's admin status from API.
 * Returns default non-admin state if user is not authenticated.
 */
async function fetchAdminStatus(): Promise<AdminStatus> {
  const response = await fetch('/api/user/admin-status')

  if (!response.ok) {
    if (response.status === 401) {
      // Not authenticated - return default state
      return { hasAdminPrivileges: false, role: null }
    }
    logger.error('Failed to fetch admin status', { status: response.status })
    throw new Error('Failed to fetch admin status')
  }

  const data = await response.json()
  return {
    hasAdminPrivileges: data.hasAdminPrivileges,
    role: data.role,
  }
}

/**
 * Hook to fetch current user's admin status
 */
export function useAdminStatus(enabled = true) {
  return useQuery({
    queryKey: adminStatusKeys.current(),
    queryFn: fetchAdminStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes - role doesn't change often
    placeholderData: keepPreviousData, // Show cached data immediately
    retry: false, // Don't retry on 401
    enabled,
  })
}
