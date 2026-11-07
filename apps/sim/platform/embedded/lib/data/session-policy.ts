'use client'

import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationSessionPolicy } from '@/lib/api/contracts/organization'
import {
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/ee/session-policy/hooks/session-policy'
import { parseSessionPolicyHours } from '@/ee/session-policy/lib/policy-form'
import { plural } from '@/platform/shared/plural'
import { toast } from '@/platform/shared/toast'

/**
 * The organization's session policy as the section shows it: still loading, failed with its retry,
 * outside the plan, or ready to edit.
 */
export function useSessionPolicy(organizationId: string, billingEnabled: boolean) {
  const { data, error, isLoading, isFetching, refetch } =
    useOrganizationSessionPolicy(organizationId)
  if (isLoading) return { status: 'loading' as const }
  if (!data) {
    return {
      status: 'failed' as const,
      message: getErrorMessage(error, 'Failed to load session policy'),
      retrying: isFetching,
      retry: () => void refetch(),
    }
  }
  if (billingEnabled && !data.isEnterprise) return { status: 'enterprise-only' as const }
  return { status: 'ready' as const, policy: data }
}

export function useSessionPolicyWrites(organizationId: string) {
  const updatePolicy = useUpdateOrganizationSessionPolicy()
  const revokeSessions = useRevokeOrganizationSessions()
  return {
    saving: updatePolicy.isPending,
    /** Reports its own failure; `onSaved` receives what the server now holds. */
    save: async (
      hours: { maxHours: string; idleHours: string },
      onSaved: (configured: OrganizationSessionPolicy['configured']) => void
    ) => {
      const parsed = parseSessionPolicyHours(hours.maxHours, hours.idleHours)
      if (!parsed.ok) {
        toast.error(parsed.error)
        return
      }
      try {
        const result = await updatePolicy.mutateAsync({
          orgId: organizationId,
          settings: {
            maxSessionHours: parsed.maxSessionHours,
            idleTimeoutHours: parsed.idleTimeoutHours,
          },
        })
        onSaved(result.data.configured)
        toast.success('Session policy updated')
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to update session policy'))
      }
    },
    revokeAll: async () => {
      const result = await revokeSessions.mutateAsync({ orgId: organizationId })
      toast.success(`Signed out ${plural(result.data.revokedSessions, 'session')}`)
    },
  }
}
