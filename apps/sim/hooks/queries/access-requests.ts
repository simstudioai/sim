'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AccessRequestScope,
  type AccessRequestStatus,
  type CreateAccessRequestBody,
  cancelAccessRequestContract,
  createAccessRequestContract,
  type DiscoverAccessRequestsQuery,
  discoverAccessRequestsContract,
  getAccessRequestSettingsContract,
  listMyAccessRequestsContract,
  listOrganizationAccessRequestsContract,
  previewAccessRequestContract,
  type ResolveAccessRequestBody,
  resolveAccessRequestContract,
  updateAccessRequestSettingsContract,
} from '@/lib/api/contracts/access-requests'
import type {
  WorkspaceCreditAvailability,
  WorkspaceUsageGate,
} from '@/lib/api/contracts/workspaces'
import { ACCESS_REQUEST_LIST_PAGE_SIZE } from '@/lib/permission-access-requests/constants'
import { permissionGroupKeys } from '@/ee/access-control/hooks/permission-groups'
import { invalidateWorkspaceUsage } from '@/hooks/queries/utils/invalidate-usage'
import { workspaceUsageKeys } from '@/hooks/queries/utils/workspace-usage-keys'

export const ACCESS_REQUESTS_STALE_TIME = 15_000
export const ACCESS_REQUESTS_POLL_INTERVAL = 30_000
export const ACCESS_REQUEST_PAGE_SIZE = ACCESS_REQUEST_LIST_PAGE_SIZE

export const accessRequestKeys = {
  all: ['accessRequests'] as const,
  lists: () => [...accessRequestKeys.all, 'list'] as const,
  mine: (scope: AccessRequestScope, offset: number, requestId?: string) =>
    [...accessRequestKeys.lists(), 'mine', scope, offset, requestId ?? ''] as const,
  organization: (organizationId: string, offset: number, status: AccessRequestStatus | 'all') =>
    [...accessRequestKeys.lists(), 'organization', organizationId, offset, status] as const,
  discoveries: () => [...accessRequestKeys.all, 'discovery'] as const,
  discovery: (query: DiscoverAccessRequestsQuery) =>
    [...accessRequestKeys.discoveries(), query] as const,
  details: () => [...accessRequestKeys.all, 'detail'] as const,
  organizationDetails: (organizationId: string) =>
    [...accessRequestKeys.details(), organizationId] as const,
  preview: (organizationId: string, requestId: string) =>
    [...accessRequestKeys.organizationDetails(organizationId), requestId] as const,
  settings: (organizationId: string) =>
    [...accessRequestKeys.all, 'settings', organizationId] as const,
}

export function useDiscoverAccessRequests(query: DiscoverAccessRequestsQuery, enabled = true) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: accessRequestKeys.discovery(query),
    queryFn: async ({ signal }) => {
      const result = await requestJson(discoverAccessRequestsContract, { query, signal })
      if (result.enabled && query.kind === 'workspace') {
        void queryClient.refetchQueries(
          {
            queryKey: permissionGroupKeys.userConfig(query.workspaceId),
            exact: true,
            type: 'active',
            stale: true,
          },
          { cancelRefetch: false }
        )
        const usageKey = workspaceUsageKeys.gate(query.workspaceId)
        const usage = queryClient.getQueryData<WorkspaceUsageGate>(usageKey)
        if (usage?.scope === 'member' && usage.isExceeded) {
          void queryClient.refetchQueries(
            { queryKey: usageKey, exact: true, type: 'active', stale: true },
            { cancelRefetch: false }
          )
        }
        const creditKey = workspaceUsageKeys.creditAvailability(query.workspaceId)
        const credit = queryClient.getQueryData<WorkspaceCreditAvailability>(creditKey)
        if (credit?.scope === 'member') {
          void queryClient.refetchQueries(
            { queryKey: creditKey, exact: true, type: 'active', stale: true },
            { cancelRefetch: false }
          )
        }
      }
      return result
    },
    enabled:
      Boolean(query.kind === 'workspace' ? query.workspaceId : query.organizationId) && enabled,
    staleTime: ACCESS_REQUESTS_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.enabled === false ? false : ACCESS_REQUESTS_POLL_INTERVAL,
  })
}

export function useMyAccessRequests(
  scope: AccessRequestScope,
  offset = 0,
  requestId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: accessRequestKeys.mine(scope, offset, requestId),
    queryFn: ({ signal }) =>
      requestJson(listMyAccessRequestsContract, {
        query: {
          ...scope,
          offset,
          limit: ACCESS_REQUEST_PAGE_SIZE,
          ...(requestId ? { requestId } : {}),
        },
        signal,
      }),
    enabled:
      Boolean(scope.kind === 'workspace' ? scope.workspaceId : scope.organizationId) && enabled,
    staleTime: ACCESS_REQUESTS_STALE_TIME,
    refetchInterval: ACCESS_REQUESTS_POLL_INTERVAL,
  })
}

export function useOrganizationAccessRequests(
  organizationId: string,
  offset = 0,
  status: AccessRequestStatus | 'all' = 'pending'
) {
  return useQuery({
    queryKey: accessRequestKeys.organization(organizationId, offset, status),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationAccessRequestsContract, {
        params: { id: organizationId },
        query: { offset, limit: ACCESS_REQUEST_PAGE_SIZE, ...(status === 'all' ? {} : { status }) },
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: ACCESS_REQUESTS_STALE_TIME,
    refetchInterval: ACCESS_REQUESTS_POLL_INTERVAL,
  })
}

export function useAccessRequestPreview(organizationId: string, requestId: string) {
  return useQuery({
    queryKey: accessRequestKeys.preview(organizationId, requestId),
    queryFn: ({ signal }) =>
      requestJson(previewAccessRequestContract, {
        params: { id: organizationId, requestId },
        signal,
      }),
    enabled: Boolean(organizationId && requestId),
    staleTime: ACCESS_REQUESTS_STALE_TIME,
  })
}

export function useCreateAccessRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAccessRequestBody) =>
      requestJson(createAccessRequestContract, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
    },
  })
}

interface CancelAccessRequestVariables {
  scope: AccessRequestScope
  requestId: string
}

export function useCancelAccessRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scope, requestId }: CancelAccessRequestVariables) =>
      requestJson(cancelAccessRequestContract, { params: { requestId }, body: { scope } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.details() })
    },
  })
}

interface ResolveAccessRequestVariables {
  organizationId: string
  requestId: string
  body: ResolveAccessRequestBody
}

export function useResolveAccessRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ organizationId, requestId, body }: ResolveAccessRequestVariables) =>
      requestJson(resolveAccessRequestContract, {
        params: { id: organizationId, requestId },
        body,
      }),
    onError: (_error, { organizationId, requestId }) => {
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.preview(organizationId, requestId),
      })
    },
    onSuccess: ({ request }) => {
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.details() })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      if (request.status !== 'fulfilled') return
      if (request.target.kind === 'usage_limit') {
        void invalidateWorkspaceUsage(queryClient)
      } else {
        void queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
      }
    },
  })
}

export function useAccessRequestSettings(organizationId: string) {
  return useQuery({
    queryKey: accessRequestKeys.settings(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getAccessRequestSettingsContract, { params: { id: organizationId }, signal }),
    enabled: Boolean(organizationId),
    staleTime: ACCESS_REQUESTS_STALE_TIME,
  })
}

export function useUpdateAccessRequestSettings(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (allowRequests: boolean) =>
      requestJson(updateAccessRequestSettingsContract, {
        params: { id: organizationId },
        body: { allowRequests },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.settings(organizationId) })
      void queryClient.invalidateQueries({ queryKey: accessRequestKeys.discoveries() })
      void queryClient.invalidateQueries({
        queryKey: accessRequestKeys.organizationDetails(organizationId),
      })
    },
  })
}
