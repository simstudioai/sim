import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  queryOptions,
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
  getMemberRemovalImpactContract,
  getOrganizationMemberUsageLimitContract,
  getOrganizationRosterContract,
  type OrganizationBillingSummary,
  type OrganizationMemberUsageLimitData,
  type OrganizationRoster,
  type RemovalImpactCredential,
  type RosterMember,
  type RosterPendingInvitation,
  type RosterWorkspaceAccess,
  removeOrganizationMemberContract,
  transferOwnershipContract,
  updateOrganizationMemberRoleContract,
  updateOrganizationMemberUsageLimitContract,
  updateOrganizationUsageLimitContract,
} from '@/lib/api/contracts/organization'
import {
  getOrganizationBillingContract,
  type OrganizationBillingApiResponse,
} from '@/lib/api/contracts/subscription'
import { client } from '@/lib/auth/auth-client'
import { isOrganizationsEnabled } from '@/lib/core/config/env-flags'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'
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
/**
 * Zero: removal impact is a consent disclosure, so every dialog open must
 * refetch — a cached list may omit credentials added moments ago, and the
 * dialog holds its confirm on `isFetching` until fresh data lands.
 */
export const ORGANIZATION_REMOVAL_IMPACT_STALE_TIME = 0

type OrganizationBillingQueryResult = UseQueryResult<OrganizationBillingApiResponse | null, Error>

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export { organizationKeys }

export type { OrganizationRoster, RosterMember, RosterPendingInvitation, RosterWorkspaceAccess }

/** Better Auth owns the authenticated membership-list endpoint. */
export function useOrganizationList() {
  return useQuery({
    queryKey: organizationKeys.lists(),
    queryFn: async ({ signal }) => {
      const response = await client.organization.list({ fetchOptions: { signal } })
      if (response.error) {
        throw new Error(response.error.message || 'Failed to load organizations')
      }
      return response.data ?? []
    },
    enabled: isOrganizationsEnabled,
    staleTime: ORGANIZATION_LIST_STALE_TIME,
  })
}

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

export function organizationRosterQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: organizationKeys.roster(orgId),
    queryFn: ({ signal }) => fetchOrganizationRoster(orgId, signal),
    staleTime: ORGANIZATION_ROSTER_STALE_TIME,
  })
}

export function useOrganizationRoster(orgId: string | undefined | null) {
  return useQuery({
    ...organizationRosterQueryOptions(orgId ?? ''),
    enabled: !!orgId,
  })
}

async function fetchMemberRemovalImpact(
  orgId: string,
  userId: string,
  signal?: AbortSignal
): Promise<RemovalImpactCredential[]> {
  const data = await requestJson(getMemberRemovalImpactContract, {
    params: { id: orgId },
    query: { userId },
    signal,
  })
  return data.credentials
}

/**
 * Identity-bound credentials the target user owns in organization workspaces —
 * the set that stops working after removal. Fetched lazily while the
 * remove-member dialog is open.
 */
export function useMemberRemovalImpact(
  orgId: string | undefined | null,
  userId: string | undefined | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: organizationKeys.removalImpact(orgId ?? '', userId ?? ''),
    queryFn: ({ signal }) => fetchMemberRemovalImpact(orgId as string, userId as string, signal),
    enabled: Boolean(orgId) && Boolean(userId) && (options?.enabled ?? true),
    staleTime: ORGANIZATION_REMOVAL_IMPACT_STALE_TIME,
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
async function fetchOrganization(orgId: string, signal?: AbortSignal) {
  const response = await client.organization.getFullOrganization({
    query: { organizationId: orgId },
    fetchOptions: { signal },
  })
  if (response.error) {
    throw new Error(response.error.message || 'Failed to load organization')
  }
  return response.data
}

export function organizationDetailQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: organizationKeys.detail(orgId),
    queryFn: ({ signal }) => fetchOrganization(orgId, signal),
    staleTime: ORGANIZATION_DETAIL_STALE_TIME,
  })
}

export function useOrganization(orgId: string) {
  return useQuery({
    ...organizationDetailQueryOptions(orgId),
    enabled: !!orgId,
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

export function organizationBillingQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: organizationKeys.billing(orgId),
    queryFn: ({ signal }) => fetchOrganizationBilling(orgId, signal),
    retry: false,
    staleTime: ORGANIZATION_BILLING_STALE_TIME,
  })
}

export function useOrganizationBilling(
  orgId: string,
  options?: { enabled?: boolean }
): OrganizationBillingQueryResult {
  return useQuery({
    ...organizationBillingQueryOptions(orgId),
    enabled: !!orgId && (options?.enabled ?? true),
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
      await queryClient.cancelQueries({
        queryKey: organizationKeys.billing(organizationId),
      })
      await queryClient.cancelQueries({
        queryKey: organizationKeys.subscription(organizationId),
      })

      const previousBillingData = queryClient.getQueryData(organizationKeys.billing(organizationId))
      const previousBillingSummary = queryClient.getQueryData(
        organizationKeys.billingSummary(organizationId)
      )
      const previousSubscriptionData = queryClient.getQueryData(
        organizationKeys.subscription(organizationId)
      )

      queryClient.setQueryData<unknown>(
        organizationKeys.billing(organizationId),
        (old: unknown) => {
          if (!isRecordLike(old) || !isRecordLike(old.data)) return old
          const usage = isRecordLike(old.data.usage) ? old.data.usage : {}
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

      queryClient.setQueryData<{
        success: true
        data: OrganizationBillingSummary
      }>(organizationKeys.billingSummary(organizationId), (old) =>
        old
          ? {
              ...old,
              data: { ...old.data, totalUsageLimit: limit },
            }
          : old
      )

      return {
        previousBillingData,
        previousBillingSummary,
        previousSubscriptionData,
        organizationId,
      }
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
      if (context?.previousBillingSummary && context?.organizationId) {
        queryClient.setQueryData(
          organizationKeys.billingSummary(context.organizationId),
          context.previousBillingSummary
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
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.billing(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.memberUsage(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.subscription(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
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
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
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
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.billing(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.subscription(variables.orgId),
      })
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
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
    },
  })
}

/**
 * Revokes an entire pending invitation, including every workspace it grants.
 *
 * Sends no workspace scope, so the route requires authority over all of it —
 * organization admin, or admin of every granted workspace. To withdraw a single
 * workspace's access instead, use `useCancelWorkspaceInvitation`.
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
        query: {},
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.billing(variables.orgId),
      })
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
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
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
