import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth-client'

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
 */
async function fetchOrganizations() {
  const [orgsResponse, activeOrgResponse, billingResponse] = await Promise.all([
    client.organization.list(),
    client.organization.getFullOrganization(),
    fetch('/api/billing?context=user').then((r) => r.json()),
  ])

  return {
    organizations: orgsResponse.data || [],
    activeOrganization: activeOrgResponse.data,
    billingData: billingResponse,
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

  // Pass query parameter to filter by referenceId (matches old store behavior)
  const response = await client.subscription.list({
    query: { referenceId: orgId },
  })

  if (response.error) {
    console.error('Error fetching organization subscription:', response.error)
    return null
  }

  // Find active team or enterprise subscription (same logic as old store)
  const teamSubscription = response.data?.find(
    (sub: any) => sub.status === 'active' && sub.plan === 'team'
  )
  const enterpriseSubscription = response.data?.find(
    (sub: any) => sub.plan === 'enterprise' || sub.plan === 'enterprise-plus'
  )
  const activeSubscription = enterpriseSubscription || teamSubscription

  // React Query requires non-undefined return values, use null instead
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
    retry: false, // Don't retry when no organization exists
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization billing data
 */
async function fetchOrganizationBilling(orgId: string) {
  const response = await fetch(`/api/billing?context=organization&id=${orgId}`)

  // Treat 404 as "no billing data available"
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
    retry: false, // Don't retry when no billing data exists
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization member usage data
 */
async function fetchOrganizationMembers(orgId: string) {
  const response = await fetch(`/api/organizations/${orgId}/members?include=usage`)

  // Treat 404 as "no members found"
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
 * Invite member mutation
 */
interface InviteMemberParams {
  email: string
  workspaceInvitations?: Array<{ id: string; name: string }>
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
        throw new Error(error.message || 'Failed to invite member')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
      // Also refetch the org list to update counts
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
      // Invalidate related queries
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
 * Update seats mutation (handles both add and reduce)
 */
interface UpdateSeatsParams {
  orgId: string
  seats: number
  subscriptionId: string
}

export function useUpdateSeats() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ seats, orgId, subscriptionId }: UpdateSeatsParams) => {
      const response = await client.subscription.upgrade({
        plan: 'team',
        referenceId: orgId,
        subscriptionId,
        seats,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })

      if (response.error) {
        throw new Error(response.error.message || 'Failed to update seats')
      }

      return response.data
    },
    onSuccess: (_data, variables) => {
      // Invalidate all related queries
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
      // Invalidate organization details
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

      // Set as active organization
      await client.organization.setActive({
        organizationId: response.data.id,
      })

      return response.data
    },
    onSuccess: () => {
      // Refetch all organizations
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
    },
  })
}
