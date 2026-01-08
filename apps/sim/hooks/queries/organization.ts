import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'

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
}

/**
 * Fetch all organizations for the current user
 * Note: Billing data is fetched separately via useSubscriptionData() to avoid duplicate calls
 */
async function fetchOrganizations() {
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
    queryFn: fetchOrganizations,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch a specific organization by ID
 */
async function fetchOrganization() {
  const response = await client.organization.getFullOrganization()
  return response.data
}

/**
 * Hook to fetch a specific organization
 */
export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.detail(orgId),
    queryFn: fetchOrganization,
    enabled: !!orgId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization subscription data
 */
async function fetchOrganizationSubscription(orgId: string) {
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

  const teamSubscription = response.data?.find(
    (sub: any) => sub.status === 'active' && sub.plan === 'team'
  )
  const enterpriseSubscription = response.data?.find(
    (sub: any) => sub.plan === 'enterprise' || sub.plan === 'enterprise-plus'
  )
  const activeSubscription = enterpriseSubscription || teamSubscription

  return activeSubscription || null
}

/**
 * Hook to fetch organization subscription
 */
export function useOrganizationSubscription(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.subscription(orgId),
    queryFn: () => fetchOrganizationSubscription(orgId),
    enabled: !!orgId,
    retry: false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization billing data
 */
async function fetchOrganizationBilling(orgId: string) {
  const response = await fetch(`/api/billing?context=organization&id=${orgId}`)

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
    queryFn: () => fetchOrganizationBilling(orgId),
    enabled: !!orgId,
    retry: false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization member usage data
 */
async function fetchOrganizationMembers(orgId: string) {
  const response = await fetch(`/api/organizations/${orgId}/members?include=usage`)

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
    queryFn: () => fetchOrganizationMembers(orgId),
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
  email: string
  workspaceInvitations?: Array<{ workspaceId: string; permission: 'admin' | 'write' | 'read' }>
  orgId: string
}

export function useInviteMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, workspaceInvitations, orgId }: InviteMemberParams) => {
      const response = await fetch(`/api/organizations/${orgId}/invitations?batch=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: [email],
          workspaceInvitations,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || error.message || 'Failed to invite member')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
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
        const error = await response.json()
        throw new Error(error.message || 'Failed to remove member')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.subscription(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
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
    mutationFn: async ({ invitationId, orgId }: CancelInvitationParams) => {
      const response = await fetch(
        `/api/organizations/${orgId}/invitations?invitationId=${invitationId}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to cancel invitation')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
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
  return useMutation({
    mutationFn: async ({ invitationId, orgId }: ResendInvitationParams) => {
      const response = await fetch(`/api/organizations/${orgId}/invitations/${invitationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to resend invitation')
      }

      return response.json()
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
      const response = await client.organization.create({
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
      })

      if (!response.data) {
        throw new Error('Failed to create organization')
      }

      await client.organization.setActive({
        organizationId: response.data.id,
      })

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
    },
  })
}
