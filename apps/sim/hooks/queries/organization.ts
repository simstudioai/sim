import { createLogger } from '@sim/logger'
import {
  keepPreviousData,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  cancelInvitationContract,
  resendInvitationContract,
  updateInvitationContract,
} from '@/lib/api/contracts/invitations'
import {
  createOrganizationContract,
  getOrganizationMemberUsageLimitContract,
  getOrganizationRosterContract,
  inviteOrganizationMembersContract,
  listOrganizationMembersContract,
  type OrganizationMembersResponse,
  type OrganizationMemberUsageLimitData,
  type OrganizationRoster,
  type RosterMember,
  type RosterPendingInvitation,
  type RosterWorkspaceAccess,
  removeOrganizationMemberContract,
  transferOwnershipContract,
  updateOrganizationContract,
  updateOrganizationMemberRoleContract,
  updateOrganizationMemberUsageLimitContract,
  updateOrganizationUsageLimitContract,
} from '@/lib/api/contracts/organization'
import {
  getOrganizationBillingContract,
  type OrganizationBillingApiResponse,
} from '@/lib/api/contracts/subscription'
import { client } from '@/lib/auth/auth-client'
import { isEnterprise, isPaid, isTeam } from '@/lib/billing/plan-helpers'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'

const logger = createLogger('OrganizationQueries')
const invitationListsKey = ['invitations', 'list'] as const

export const ORGANIZATION_ROSTER_STALE_TIME = 30 * 1000
export const ORGANIZATION_LIST_STALE_TIME = 30 * 1000
export const ORGANIZATION_DETAIL_STALE_TIME = 30 * 1000
export const ORGANIZATION_SUBSCRIPTION_STALE_TIME = 30 * 1000
export const ORGANIZATION_BILLING_STALE_TIME = 30 * 1000
export const ORGANIZATION_MEMBERS_STALE_TIME = 30 * 1000
export const ORGANIZATION_MEMBER_USAGE_LIMIT_STALE_TIME = 30 * 1000

type OrganizationSubscriptionCandidate = {
  id: string
  referenceId: string
  status: string
  plan: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
}

type OrganizationBillingQueryResult = UseQueryResult<OrganizationBillingApiResponse | null, Error>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOrganizationSubscriptionCandidate(
  value: unknown
): value is OrganizationSubscriptionCandidate {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.referenceId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.plan === 'string' &&
    (value.cancelAtPeriodEnd === undefined || typeof value.cancelAtPeriodEnd === 'boolean') &&
    (value.periodEnd === undefined ||
      typeof value.periodEnd === 'number' ||
      value.periodEnd instanceof Date) &&
    (value.trialEnd === undefined ||
      typeof value.trialEnd === 'number' ||
      value.trialEnd instanceof Date)
  )
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

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
  memberUsageLimit: (id: string, userId: string) =>
    [...organizationKeys.detail(id), 'member-usage-limit', userId] as const,
  roster: (id: string) => [...organizationKeys.detail(id), 'roster'] as const,
}

export type { OrganizationRoster, RosterMember, RosterPendingInvitation, RosterWorkspaceAccess }

async function fetchOrganizationRoster(
  orgId: string,
  signal?: AbortSignal
): Promise<OrganizationRoster | null> {
  if (!orgId) return null

  try {
    const payload = await requestJson(getOrganizationRosterContract, {
      params: { id: orgId },
      signal,
    })
    return payload.data
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null
    }
    throw error
  }
}

export function useOrganizationRoster(orgId: string | undefined | null) {
  return useQuery({
    queryKey: organizationKeys.roster(orgId ?? ''),
    queryFn: ({ signal }) => fetchOrganizationRoster(orgId as string, signal),
    enabled: !!orgId,
    staleTime: ORGANIZATION_ROSTER_STALE_TIME,
  })
}

/**
 * Fetches the current viewer's account-scoped organizations.
 *
 * `activeOrganization` reflects the viewer session's selected organization. It
 * must not be used as the organization context for a routed workspace; those
 * surfaces use the workspace host context instead. Billing data is fetched
 * separately, and the Better Auth client does not accept an AbortSignal.
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
 * Reads the viewer's account organizations and account-scoped active organization.
 *
 * Workspace-bound consumers must use the routed workspace host context instead
 * of `activeOrganization`.
 */
export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.lists(),
    queryFn: ({ signal }) => fetchOrganizations(signal),
    staleTime: ORGANIZATION_LIST_STALE_TIME,
  })
}

/**
 * Fetch a specific organization by ID.
 *
 * `getFullOrganization` defaults to the active organization when no
 * `organizationId` is supplied; passing `orgId` through scopes the result to the
 * requested org so it is cached under the correct `organizationKeys.detail(orgId)`
 * (no cross-org cache collision). The active-org caller passes the active org's
 * id, so its behavior is unchanged.
 */
async function fetchOrganization(orgId: string, _signal?: AbortSignal) {
  const response = await client.organization.getFullOrganization({
    query: { organizationId: orgId },
  })
  return response.data
}

/**
 * Hook to fetch a specific organization
 */
export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.detail(orgId),
    queryFn: ({ signal }) => fetchOrganization(orgId, signal),
    enabled: !!orgId,
    staleTime: ORGANIZATION_DETAIL_STALE_TIME,
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
  const rawSubscriptions: unknown = response.data
  const entitled = (Array.isArray(rawSubscriptions) ? rawSubscriptions : [])
    .filter(isOrganizationSubscriptionCandidate)
    .filter((sub) => hasPaidSubscriptionStatus(sub.status) && isPaid(sub.plan))
  const enterpriseSubscription = entitled.find((sub) => isEnterprise(sub.plan))
  const teamSubscription = entitled.find((sub) => isTeam(sub.plan))
  const proSubscription = entitled.find((sub) => !isEnterprise(sub.plan) && !isTeam(sub.plan))
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
    staleTime: ORGANIZATION_SUBSCRIPTION_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch organization billing data
 */
async function fetchOrganizationBilling(
  orgId: string,
  signal?: AbortSignal
): Promise<OrganizationBillingApiResponse | null> {
  try {
    return await requestJson(getOrganizationBillingContract, {
      query: { context: 'organization', id: orgId },
      signal,
    })
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null
    }
    throw error
  }
}

/**
 * Hook to fetch organization billing data
 */
export function useOrganizationBilling(
  orgId: string,
  options?: { enabled?: boolean }
): OrganizationBillingQueryResult {
  return useQuery({
    queryKey: organizationKeys.billing(orgId),
    queryFn: ({ signal }) => fetchOrganizationBilling(orgId, signal),
    enabled: !!orgId && (options?.enabled ?? true),
    retry: false,
    staleTime: ORGANIZATION_BILLING_STALE_TIME,
  })
}

/**
 * Fetch organization member usage data
 */
async function fetchOrganizationMembers(
  orgId: string,
  signal?: AbortSignal
): Promise<OrganizationMembersResponse> {
  try {
    return await requestJson(listOrganizationMembersContract, {
      params: { id: orgId },
      query: { include: 'usage' },
      signal,
    })
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return {
        success: true,
        data: [],
        total: 0,
        userRole: 'member',
        hasAdminAccess: false,
      }
    }
    throw error
  }
}

/**
 * Hook to fetch organization members with usage data
 */
export function useOrganizationMembers(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.memberUsage(orgId),
    queryFn: ({ signal }) => fetchOrganizationMembers(orgId, signal),
    enabled: !!orgId,
    staleTime: ORGANIZATION_MEMBERS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Update organization usage limit mutation with optimistic updates
 */
type UpdateOrganizationUsageLimitParams = Pick<
  ContractBodyInput<typeof updateOrganizationUsageLimitContract>,
  'organizationId' | 'limit'
>

export function useUpdateOrganizationUsageLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, limit }: UpdateOrganizationUsageLimitParams) => {
      return requestJson(updateOrganizationUsageLimitContract, {
        body: { context: 'organization', organizationId, limit },
      })
    },
    onMutate: async ({ organizationId, limit }) => {
      await queryClient.cancelQueries({ queryKey: organizationKeys.billing(organizationId) })
      await queryClient.cancelQueries({ queryKey: organizationKeys.subscription(organizationId) })

      const previousBillingData = queryClient.getQueryData(organizationKeys.billing(organizationId))
      const previousSubscriptionData = queryClient.getQueryData(
        organizationKeys.subscription(organizationId)
      )

      queryClient.setQueryData<unknown>(
        organizationKeys.billing(organizationId),
        (old: unknown) => {
          if (!isRecord(old) || !isRecord(old.data)) return old
          const usage = isRecord(old.data.usage) ? old.data.usage : {}
          const currentUsage =
            readNumber(old.data.currentUsage) ??
            readNumber(usage.current) ??
            readNumber(old.data.totalCurrentUsage) ??
            0
          const newPercentUsed = limit > 0 ? (currentUsage / limit) * 100 : 0

          return {
            ...old,
            data: {
              ...old.data,
              totalUsageLimit: limit,
              usage: {
                ...usage,
                limit,
                percentUsed: newPercentUsed,
              },
              percentUsed: newPercentUsed,
            },
          }
        }
      )

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
type InviteMemberParams = Pick<
  ContractBodyInput<typeof inviteOrganizationMembersContract>,
  'emails' | 'workspaceInvitations'
> & {
  orgId: string
}

export function useInviteMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ emails, workspaceInvitations, orgId }: InviteMemberParams) => {
      /**
       * Partial batches return HTTP 207 with `success: false` and a `data`
       * payload (some invited/added, some failed). `requestJson` only throws on
       * >= 400 (e.g. the total-failure 502 / validation 400 paths), so partials
       * resolve here and the caller reports successes + per-email failures from
       * `data` instead of surfacing a single generic error.
       */
      return requestJson(inviteOrganizationMembersContract, {
        params: { id: orgId },
        query: { batch: true },
        body: {
          emails,
          workspaceInvitations,
        },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      // Existing members may have been added directly to selected workspaces.
      for (const grant of variables.workspaceInvitations ?? []) {
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.permissions(grant.workspaceId),
        })
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.members(grant.workspaceId),
        })
      }
    },
  })
}

/**
 * Remove member mutation
 */
interface RemoveMemberParams {
  memberId: string
  orgId: string
}

export function useRemoveMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberId, orgId }: RemoveMemberParams) => {
      return requestJson(removeOrganizationMemberContract, {
        params: { id: orgId, memberId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.memberUsage(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.subscription(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.all })
      queryClient.invalidateQueries({ queryKey: invitationListsKey })
    },
  })
}

interface UpdateMemberRoleParams {
  orgId: string
  userId: string
  role: ContractBodyInput<typeof updateOrganizationMemberRoleContract>['role']
}

export function useUpdateOrganizationMemberRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, userId, role }: UpdateMemberRoleParams) => {
      return requestJson(updateOrganizationMemberRoleContract, {
        params: { id: orgId, memberId: userId },
        body: { role },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
    },
  })
}

async function fetchOrganizationMemberUsageLimit(
  orgId: string,
  userId: string,
  signal?: AbortSignal
): Promise<OrganizationMemberUsageLimitData> {
  const response = await requestJson(getOrganizationMemberUsageLimitContract, {
    params: { id: orgId, memberId: userId },
    signal,
  })
  return response.data
}

/**
 * Hook to fetch a single member's per-org credit usage + cap (values in credits).
 * Lazily enabled so it only fires while the Manage Credits modal is open.
 */
export function useOrganizationMemberUsageLimit(orgId?: string, userId?: string, enabled = true) {
  return useQuery({
    queryKey: organizationKeys.memberUsageLimit(orgId ?? '', userId ?? ''),
    queryFn: ({ signal }) =>
      fetchOrganizationMemberUsageLimit(orgId as string, userId as string, signal),
    enabled: Boolean(orgId) && Boolean(userId) && enabled,
    staleTime: ORGANIZATION_MEMBER_USAGE_LIMIT_STALE_TIME,
  })
}

interface UpdateMemberUsageLimitParams {
  orgId: string
  userId: string
  creditLimit: ContractBodyInput<typeof updateOrganizationMemberUsageLimitContract>['creditLimit']
}

export function useUpdateOrganizationMemberUsageLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, userId, creditLimit }: UpdateMemberUsageLimitParams) => {
      return requestJson(updateOrganizationMemberUsageLimitContract, {
        params: { id: orgId, memberId: userId },
        body: { creditLimit },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.memberUsageLimit(variables.orgId, variables.userId),
      })
    },
  })
}

type TransferOwnershipParams = {
  orgId: string
} & ContractBodyInput<typeof transferOwnershipContract>

export function useTransferOwnership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, newOwnerUserId, alsoLeave = false }: TransferOwnershipParams) => {
      return requestJson(transferOwnershipContract, {
        params: { id: orgId },
        body: { newOwnerUserId, alsoLeave },
      })
    },
    onSettled: (_data, _error, variables) => {
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

type UpdateInvitationParams = {
  orgId: string
  invitationId: string
} & ContractBodyInput<typeof updateInvitationContract>

export function useUpdateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId, role, grants }: UpdateInvitationParams) => {
      return requestJson(updateInvitationContract, {
        params: { id: invitationId },
        body: { role, grants },
      })
    },
    onSettled: (_data, _error, variables) => {
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
      return requestJson(cancelInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.billing(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: invitationListsKey })
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
      return requestJson(resendInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.roster(variables.orgId) })
    },
  })
}

/**
 * Update organization settings mutation
 */
type UpdateOrganizationParams = {
  orgId: string
} & ContractBodyInput<typeof updateOrganizationContract>

export function useUpdateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, ...updates }: UpdateOrganizationParams) => {
      return requestJson(updateOrganizationContract, {
        params: { id: orgId },
        body: updates,
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(variables.orgId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

/**
 * Create organization mutation
 */
type CreateOrganizationParams = Pick<
  ContractBodyInput<typeof createOrganizationContract>,
  'slug'
> & {
  name: string
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, slug }: CreateOrganizationParams) => {
      const data = await requestJson(createOrganizationContract, {
        body: {
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        },
      })

      await client.organization.setActive({
        organizationId: data.organizationId,
      })

      return data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}
