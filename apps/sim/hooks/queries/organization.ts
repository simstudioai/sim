import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import { isEnterprise, isPaid, isTeam } from '@/lib/billing/plan-helpers'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { workspaceKeys } from '@/hooks/queries/workspace'

const logger = createLogger('OrganizationQueries')

/**
 * Query key factories for organization-related queries
 * This ensures consistent cache invalidation across the app
 */
export const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  details: () => [...organizationKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationKeys.details(), id] as const,
  subscription: (id: string) => [...organizationKeys.detail(id), 'subscription'] as const,
  billing: (id: string) => [...organizationKeys.detail(id), 'billing'] as const,
  members: (id: string) => [...organizationKeys.detail(id), 'members'] as const,
  memberUsage: (id: string) => [...organizationKeys.detail(id), 'member-usage'] as const,
  roster: (id: string) => [...organizationKeys.detail(id), 'roster'] as const,
}

export type RosterWorkspaceAccess = {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

export type RosterMember = {
  memberId: string
  userId: string
  role: string
  createdAt: string
  name: string
  email: string
  image: string | null
  workspaces: RosterWorkspaceAccess[]
}

export type RosterPendingInvitation = {
  id: string
  email: string
  role: string
  kind: 'organization' | 'workspace'
  createdAt: string
  expiresAt: string
  inviteeName: string | null
  inviteeImage: string | null
  workspaces: RosterWorkspaceAccess[]
}

export type OrganizationRoster = {
  members: RosterMember[]
  pendingInvitations: RosterPendingInvitation[]
  workspaces: Array<{ id: string; name: string }>
}

async function fetchOrganizationRoster(
  orgId: string,
  signal?: AbortSignal
): Promise<OrganizationRoster | null> {
  if (!orgId) return null

  const response = await fetch(`/api/organizations/${orgId}/roster`, { signal })
  if (response.status === 403 || response.status === 404) return null
  if (!response.ok) {
    throw new Error('Failed to fetch organization roster')
  }
  const payload = await response.json()
  return payload.data as OrganizationRoster
}

export function useOrganizationRoster(orgId: string | undefined | null) {
  return useQuery({
    queryKey: organizationKeys.roster(orgId ?? ''),
    queryFn: ({ signal }) => fetchOrganizationRoster(orgId as string, signal),
    enabled: !!orgId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch all organizations for the current user
 * Note: Billing data is fetched separately via useSubscriptionData() to avoid duplicate calls
 * Note: better-auth client does not support AbortSignal, so signal is accepted but not forwarded
 */
async function fetchOrganizations(_signal?: AbortSignal) {
  const [orgsResponse, activeOrgResponse] = await Promise.all([
    client.organization.list(),
    client.organization.getFullOrganization(),
  ])

  return {
    organizations: orgsResponse.data || [],
    activeOrganization: activeOrgResponse.data,
  }
}

/**
 * Hook to fetch all organizations
 */
export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.lists(),
    queryFn: ({ signal }) => fetchOrganizations(signal),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetch a specific organization by ID
 */
async function fetchOrganization(_signal?: AbortSignal) {
  const response = await client.organization.getFullOrganization()
  return response.data
}

/**
 * Hook to fetch a specific organization
 */
export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.detail(orgId),
    queryFn: ({ signal }) => fetchOrganization(signal),
    enabled: !!orgId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization subscription data
 */
async function fetchOrganizationSubscription(orgId: string, _signal?: AbortSignal) {
  if (!orgId) {
    return null
  }

  const response = await client.subscription.list({
    query: { referenceId: orgId },
  })

  if (response.error) {
    logger.error('Error fetching organization subscription', { error: response.error })
    return null
  }

  // Any paid subscription attached to the org counts as its active sub.
  // Priority: Enterprise > Team > Pro (matches `getHighestPrioritySubscription`).
  // This intentionally includes `pro_*` plans that have been transferred
  // to the org — they are pooled org-scoped subscriptions.
  const entitled = (response.data || []).filter(
    (sub: any) => hasPaidSubscriptionStatus(sub.status) && isPaid(sub.plan)
  )
  const enterpriseSubscription = entitled.find((sub: any) => isEnterprise(sub.plan))
  const teamSubscription = entitled.find((sub: any) => isTeam(sub.plan))
  const proSubscription = entitled.find((sub: any) => !isEnterprise(sub.plan) && !isTeam(sub.plan))
  const activeSubscription = enterpriseSubscription || teamSubscription || proSubscription

  return activeSubscription || null
}

/**
 * Hook to fetch organization subscription
 */
export function useOrganizationSubscription(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.subscription(orgId),
    queryFn: ({ signal }) => fetchOrganizationSubscription(orgId, signal),
    enabled: !!orgId,
    retry: false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization billing data
 */
async function fetchOrganizationBilling(orgId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/billing?context=organization&id=${orgId}`, { signal })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Failed to fetch organization billing data')
  }
  return response.json()
}

/**
 * Hook to fetch organization billing data
 */
export function useOrganizationBilling(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.billing(orgId),
    queryFn: ({ signal }) => fetchOrganizationBilling(orgId, signal),
    enabled: !!orgId,
    retry: false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization member usage data
 */
async function fetchOrganizationMembers(orgId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/organizations/${orgId}/members?include=usage`, { signal })

  if (response.status === 404) {
    return { members: [] }
  }

  if (!response.ok) {
    throw new Error('Failed to fetch organization members')
  }
  return response.json()
}

/**
 * Hook to fetch organization members with usage data
 */
export function useOrganizationMembers(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.memberUsage(orgId),
    queryFn: ({ signal }) => fetchOrganizationMembers(orgId, signal),
    enabled: !!orgId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Update organization usage limit mutation with optimistic updates
 */
interface UpdateOrganizationUsageLimitParams {
  organizationId: string
  limit: number
}

export function useUpdateOrganizationUsageLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, limit }: UpdateOrganizationUsageLimitParams) => {
      const response = await fetch('/api/usage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'organization', organizationId, limit }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || error.error || 'Failed to update usage limit')
      }

      return response.json()
    },
    onMutate: async ({ organizationId, limit }) => {
      await queryClient.cancelQueries({ queryKey: organizationKeys.billing(organizationId) })
      await queryClient.cancelQueries({ queryKey: organizationKeys.subscription(organizationId) })

      const previousBillingData = queryClient.getQueryData(organizationKeys.billing(organizationId))
      const previousSubscriptionData = queryClient.getQueryData(
        organizationKeys.subscription(organizationId)
      )

      queryClient.setQueryData(organizationKeys.billing(organizationId), (old: any) => {
        if (!old) return old
        const currentUsage = old.data?.currentUsage || old.data?.usage?.current || 0
        const newPercentUsed = limit > 0 ? (currentUsage / limit) * 100 : 0

        return {
          ...old,
          data: {
            ...old.data,
            totalUsageLimit: limit,
            usage: {
              ...old.data?.usage,
              limit,
              percentUsed: newPercentUsed,
            },
            percentUsed: newPercentUsed,
          },
        }
      })

      return { previousBillingData, previousSubscriptionData, organizationId }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousBillingData && context?.organizationId) {
        queryClient.setQueryData(
          organizationKeys.billing(context.organizationId),
          context.previousBillingData
        )
      }
      if (context?.previousSubscriptionData && context?.organizationId) {
        queryClient.setQueryData(
          organizationKeys.subscription(context.organizationId),
          context.previousSubscriptionData
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.billing(variables.organizationId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.subscription(variables.organizationId),
      })
    },
  })
}

/**
 * Invite member mutation
 */
interface InviteMemberParams {
  emails: string[]
  workspaceInvitations?: Array<{ workspaceId: string; permission: 'admin' | 'write' | 'read' }>
  orgId: string
}

export function useInviteMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ emails, workspaceInvitations, orgId }: InviteMemberParams) => {
      const response = await fetch(`/api/organizations/${orgId}/invitations?batch=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails,
          workspaceInvitations,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to invite member')
      }

      if (result.success === false) {
        throw new Error(result.error || result.message || 'Failed to invite member')
      }

      return result
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

/**
 * Remove member mutation
 */
interface RemoveMemberParams {
  memberId: string
  orgId: string
  shouldReduceSeats?: boolean
}

export function useRemoveMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberId, orgId, shouldReduceSeats }: RemoveMemberParams) => {
      const response = await fetch(
        `/api/organizations/${orgId}/members/${memberId}?shouldReduceSeats=${shouldReduceSeats}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || error.message || 'Failed to remove member')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.subscription(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
    },
  })
}

interface UpdateMemberRoleParams {
  orgId: string
  userId: string
  role: 'admin' | 'member'
}

export function useUpdateOrganizationMemberRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, userId, role }: UpdateMemberRoleParams) => {
      const response = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || error.message || 'Failed to update role')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
    },
  })
}

interface TransferOwnershipParams {
  orgId: string
  newOwnerUserId: string
  alsoLeave?: boolean
}

export function useTransferOwnership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, newOwnerUserId, alsoLeave = false }: TransferOwnershipParams) => {
      const response = await fetch(`/api/organizations/${orgId}/transfer-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOwnerUserId, alsoLeave }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || error.message || 'Failed to transfer ownership')
      }
      return response.json() as Promise<{
        success: boolean
        transferred: boolean
        left: boolean
        warning?: string
        details?: Record<string, unknown>
      }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.subscription(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

interface UpdateInvitationParams {
  orgId: string
  invitationId: string
  role?: 'admin' | 'member'
  grants?: Array<{ workspaceId: string; permission: 'read' | 'write' | 'admin' }>
}

export function useUpdateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId, role, grants }: UpdateInvitationParams) => {
      const response = await fetch(`/api/invitations/${invitationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, grants }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || error.message || 'Failed to update invitation')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
    },
  })
}

/**
 * Cancel invitation mutation
 */
interface CancelInvitationParams {
  invitationId: string
  orgId: string
}

export function useCancelInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: CancelInvitationParams) => {
      const response = await fetch(`/api/invitations/${invitationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || error.error || 'Failed to cancel invitation')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

/**
 * Resend invitation mutation
 */
interface ResendInvitationParams {
  invitationId: string
  orgId: string
}

export function useResendInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: ResendInvitationParams) => {
      const response = await fetch(`/api/invitations/${invitationId}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || error.error || 'Failed to resend invitation')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
    },
  })
}

/**
 * Update seats mutation (handles both add and reduce)
 */
interface UpdateSeatsParams {
  orgId: string
  seats: number
}

export function useUpdateSeats() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ seats, orgId }: UpdateSeatsParams) => {
      const response = await fetch(`/api/organizations/${orgId}/seats`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update seats')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.subscription(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

/**
 * Update organization settings mutation
 */
interface UpdateOrganizationParams {
  orgId: string
  name?: string
  slug?: string
  logo?: string | null
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, ...updates }: UpdateOrganizationParams) => {
      const response = await fetch(`/api/organizations/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update organization')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

/**
 * Create organization mutation
 */
interface CreateOrganizationParams {
  name: string
  slug?: string
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, slug }: CreateOrganizationParams) => {
      const response = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || error.message || 'Failed to create organization')
      }

      const data = await response.json()

      await client.organization.setActive({
        organizationId: data.organizationId,
      })

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}
