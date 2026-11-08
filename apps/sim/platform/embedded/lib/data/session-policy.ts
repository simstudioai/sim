'use client'

import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationSessionPolicy } from '@/lib/api/contracts/organization'
import type { OrganizationNetwork } from '@/lib/api/contracts/organization-network'
import {
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/ee/session-policy/hooks/session-policy'
import { parseSessionPolicyHours } from '@/ee/session-policy/lib/policy-form'
import { useOrganizationNetwork } from '@/hooks/queries/organization-network'
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

function outboundAddresses(network: OrganizationNetwork) {
  if (network.mode === 'unavailable') return { kind: 'unavailable' as const }
  if (network.mode === 'gateway' && network.publicIps.length > 0) {
    return { kind: 'allowlist' as const, publicIps: network.publicIps }
  }
  return {
    kind: 'none' as const,
    message:
      network.mode === 'blocked'
        ? 'Supported HTTPS connections are paused.'
        : network.mode === 'gateway'
          ? 'Your outbound IP addresses aren’t available yet.'
          : 'Outbound IP addresses are not configured for this organization.',
  }
}

/**
 * The organization's outbound traffic as the section words it: the addresses to allowlist, why there
 * are none, or that the deployment could not say.
 */
export function useOutboundAddresses(organizationId: string) {
  const { data, error, isFetching, refetch } = useOrganizationNetwork(organizationId)
  return { data: data && outboundAddresses(data), error, isFetching, refetch }
}
