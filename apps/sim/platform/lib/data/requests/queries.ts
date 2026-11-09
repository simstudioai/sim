'use client'

import { useQueryStates } from 'nuqs'
import type {
  AccessRequestRecord,
  AccessRequestScope,
  AccessRequestTarget,
} from '@/lib/api/contracts/access-requests'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  accessRequestSettingsSearchParams,
  accessRequestUrlOptions,
  accessReviewSearchParams,
} from '@/ee/access-requests/components/search-params'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/ee/access-requests/components/status'
import {
  describePolicyChange,
  describePolicyValue,
} from '@/ee/access-requests/lib/policy-description'
import { getAccessRequestTargetKey } from '@/ee/access-requests/lib/targets'
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useAccessRequestPreview,
  useAccessRequestSettings,
  useCancelAccessRequest,
  useCreateAccessRequest,
  useDiscoverAccessRequests,
  useMyAccessRequests,
  useOrganizationAccessRequests,
  useResolveAccessRequest,
  useUpdateAccessRequestSettings,
} from '@/hooks/queries/access-requests'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { formatInstantDate } from '@/platform/shared/time'

export { getAccessRequestTargetKey }
export type RequestRecord = AccessRequestRecord
export type RequestScope = AccessRequestScope
export type RequestTarget = AccessRequestTarget
export type RequestStatusFilter = AccessRequestRecord['status'] | 'all'

export const REQUEST_STATUS_OPTIONS: ReadonlyArray<{ value: RequestStatusFilter; label: string }> =
  [
    { value: 'pending', label: ACCESS_REQUEST_STATUS_LABELS.pending },
    { value: 'fulfilled', label: ACCESS_REQUEST_STATUS_LABELS.fulfilled },
    { value: 'declined', label: ACCESS_REQUEST_STATUS_LABELS.declined },
    { value: 'cancelled', label: ACCESS_REQUEST_STATUS_LABELS.cancelled },
    { value: 'closed', label: ACCESS_REQUEST_STATUS_LABELS.closed },
    { value: 'all', label: 'All requests' },
  ]

const STATUS_INTENT = {
  pending: 'info',
  fulfilled: 'success',
  declined: 'danger',
  cancelled: 'neutral',
  closed: 'neutral',
} as const

function statusTag(status: AccessRequestRecord['status']) {
  return { label: ACCESS_REQUEST_STATUS_LABELS[status], intent: STATUS_INTENT[status] }
}

function requestDate(request: AccessRequestRecord): string {
  return formatInstantDate(request.createdAt)
}

function requesterName(request: AccessRequestRecord): string {
  return request.requester.name || request.requester.email
}

/**
 * The same query keys as the legacy section, so an email or saved link opens the same view. The
 * legacy section reads these in two groups; one view of the URL owns both here.
 */
const REQUESTS_PARAMS = {
  ...accessRequestSettingsSearchParams,
  'request-search': accessReviewSearchParams['request-search'],
  'request-page': accessReviewSearchParams['request-page'],
  'request-status': accessReviewSearchParams['request-status'],
} as const

export function useRequestsUrl(canReview: boolean) {
  const [params, setParams] = useQueryStates(REQUESTS_PARAMS, accessRequestUrlOptions)
  const view =
    params.view === 'review' && !canReview
      ? ('requests' as const)
      : (params.view ?? (canReview ? ('review' as const) : ('requests' as const)))
  return { params, setParams, view }
}

/** My requests, the catalog behind Browse access, and whether the catalog tab has anything. */
export function useMyRequests(scope: RequestScope, view: 'requests' | 'catalog' | 'review') {
  const [params, setParams] = useQueryStates(REQUESTS_PARAMS, accessRequestUrlOptions)
  const { search, page } = params
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ search: value, page: 0 }, options)
  )
  const debounced = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const offset = page * ACCESS_REQUEST_PAGE_SIZE
  const requests = useMyAccessRequests(scope, offset, undefined, view === 'requests')
  const catalog = useDiscoverAccessRequests({
    ...scope,
    search: view === 'catalog' ? debounced : '',
    state: 'requestable',
    limit: view === 'catalog' ? ACCESS_REQUEST_PAGE_SIZE : 1,
    offset: view === 'catalog' ? offset : 0,
  })
  const current = view === 'requests' ? requests : catalog
  return {
    search,
    query: debounced,
    setSearch,
    page,
    setPage: (next: number) => void setParams({ page: next }),
    searching: view === 'catalog' && search.trim() !== debounced,
    loading: current.isPending,
    error: current.isError ? current.error : null,
    fetching: current.isFetching,
    retry: () => void current.refetch(),
    hasMore: Boolean(current.data?.hasMore),
    showCatalog: catalog.isSuccess && catalog.data.entries.length > 0,
    paused: catalog.isSuccess && !catalog.data.enabled && Boolean(catalog.data.organizationId),
    catalogEnabled: Boolean(catalog.data?.enabled),
    hasOrganization: Boolean(catalog.data?.organizationId),
    rows: (requests.data?.requests ?? []).map((request) => ({
      id: request.id,
      title: request.targetLabel,
      date: requestDate(request),
      status: statusTag(request.status),
    })),
    entries: (catalog.data?.entries ?? []).map((entry) => ({
      key: `${entry.target.kind}/${getAccessRequestTargetKey(entry.target)}`,
      label: entry.label,
      target: entry.target,
      state: entry.state,
      pendingRequestId: entry.pendingRequestId,
    })),
  }
}

export function useRequestDetails(scope: RequestScope, requestId: string) {
  const details = useMyAccessRequests(scope, 0, requestId)
  const cancel = useCancelAccessRequest()
  const request = details.isSuccess ? details.data.requests[0] : undefined
  return {
    loading: details.isPending,
    missing: details.isSuccess && !request,
    error: details.isError ? details.error : null,
    fetching: details.isFetching,
    retry: () => void details.refetch(),
    request: request && {
      title: request.targetLabel,
      date: requestDate(request),
      status: statusTag(request.status),
      pending: request.status === 'pending',
      reason: request.reason,
      decisionReason: request.decisionReason,
    },
    /** Resolves with the sentence the tray reports. */
    cancel: async () => {
      const { request: cancelled } = await cancel.mutateAsync({ scope, requestId })
      return `Request ${ACCESS_REQUEST_STATUS_LABELS[cancelled.status].toLowerCase()}`
    },
  }
}

export function useRequestAccess(scope: RequestScope, target: RequestTarget) {
  const discovery = useDiscoverAccessRequests({
    ...scope,
    targetKind: target.kind,
    targetKey: getAccessRequestTargetKey(target),
    limit: 1,
    offset: 0,
  })
  const create = useCreateAccessRequest()
  const entry = discovery.isSuccess ? discovery.data.entries[0] : undefined
  const pendingRequestId = entry?.pendingRequestId ?? null
  const canRequest = Boolean(
    discovery.data?.enabled && entry?.state === 'requestable' && !pendingRequestId
  )
  const alreadyAllowed = entry?.state === 'allowed'
  const usageLimit = target.kind === 'usage_limit'
  return {
    usageLimit,
    loading: discovery.isPending,
    loadError: discovery.error,
    retry: () => void discovery.refetch(),
    pendingRequestId,
    canRequest,
    alreadyAllowed,
    unavailableReason:
      discovery.isSuccess && !pendingRequestId && !canRequest && !alreadyAllowed
        ? !discovery.data.enabled && discovery.data.organizationId && entry?.state === 'requestable'
          ? 'Access requests are paused for your organization.'
          : (entry?.reason ?? 'Access requests are unavailable.')
        : null,
    /** Resolves with the sentence the tray reports. */
    send: async (reason: string) => {
      const { request } = await create.mutateAsync({ scope, target, reason: reason.trim() })
      if (request.status === 'closed')
        return request.decisionReason ?? 'Access is already available.'
      return usageLimit ? 'Credit limit increase requested.' : 'Access requested.'
    },
  }
}

/**
 * What a page a permission group hides tells its viewer, as legacy's access boundary words it: a
 * pending request to view, an access request to send, a refresh once access is back, or why it
 * cannot be requested.
 */
export function useFeatureAccessPrompt(
  workspaceId: string,
  configKey: Extract<RequestTarget, { kind: 'feature' }>['configKey']
) {
  const target: RequestTarget = { kind: 'feature', configKey }
  const discovery = useDiscoverAccessRequests({
    kind: 'workspace',
    workspaceId,
    targetKind: target.kind,
    targetKey: getAccessRequestTargetKey(target),
    limit: 1,
    offset: 0,
  })
  const entry = discovery.isSuccess ? discovery.data.entries[0] : undefined
  const enabled = Boolean(discovery.data?.enabled)
  const requestable = entry?.state === 'requestable'
  const pendingRequestId = (enabled && requestable && entry.pendingRequestId) || null
  return {
    loading: discovery.isPending,
    error: discovery.error,
    retry: () => void discovery.refetch(),
    target,
    label: entry?.label ?? '',
    allowed: entry?.state === 'allowed',
    pendingRequestId,
    canRequest: enabled && requestable && !pendingRequestId,
    description: pendingRequestId
      ? 'Your request is pending.'
      : enabled && requestable
        ? 'Ask an administrator for access.'
        : requestable
          ? 'Access requests are paused for your organization.'
          : (entry?.reason ?? 'Your organization restricts this feature.'),
  }
}

export function useReviewList(organizationId: string) {
  const [params, setParams] = useQueryStates(REQUESTS_PARAMS, accessRequestUrlOptions)
  const search = params['request-search']
  const page = params['request-page']
  const status = params['request-status']
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ 'request-search': value, 'request-page': 0 }, options)
  )
  const debounced = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const searching = search.trim() !== debounced
  const requests = useOrganizationAccessRequests(
    organizationId,
    page * ACCESS_REQUEST_PAGE_SIZE,
    status,
    debounced
  )
  const settings = useAccessRequestSettings(organizationId)
  const updateSettings = useUpdateAccessRequestSettings(organizationId)
  const statusLabel = status === 'all' ? null : ACCESS_REQUEST_STATUS_LABELS[status]
  return {
    search,
    query: debounced,
    setSearch,
    page,
    setPage: (next: number) => void setParams({ 'request-page': next }),
    status,
    setStatus: (next: RequestStatusFilter) =>
      void setParams({ 'request-status': next, 'request-page': 0 }),
    statusLabel,
    searching,
    loading: requests.isPending,
    error: requests.isError ? requests.error : null,
    fetching: requests.isFetching,
    retry: () => void requests.refetch(),
    hasMore: Boolean(requests.data?.hasMore),
    count: !searching && !requests.isError ? requests.data?.total : undefined,
    rows: (requests.data?.requests ?? []).map((request) => ({
      id: request.id,
      title: request.targetLabel,
      detail: `${requesterName(request)} · ${requestDate(request)}`,
      status: statusTag(request.status),
    })),
    settings: {
      loading: settings.isPending,
      error: settings.isError ? settings.error : null,
      fetching: settings.isFetching,
      retry: () => void settings.refetch(),
      allowed: settings.data?.allowRequests ?? false,
      updating: updateSettings.isPending,
      update: updateSettings.mutateAsync,
    },
  }
}

const DESCRIBE_FALLBACK = 'No longer available'

/**
 * One request's preview and its resolution. The apply carries the fingerprint of the preview the
 * admin read, so a policy that moved underneath them is refused rather than applied blind.
 */
export function useRequestReview(organizationId: string, requestId: string) {
  const preview = useAccessRequestPreview(organizationId, requestId)
  const resolve = useResolveAccessRequest()
  const data = preview.isSuccess ? preview.data : undefined
  const pending = data?.request.status === 'pending'
  const decided = data?.request.status === 'pending' || data?.request.status === 'fulfilled'
  const permission = data?.resolutionKind === 'permission'
  return {
    loading: preview.isPending,
    loadError: preview.isError ? preview.error : null,
    fetching: preview.isFetching,
    retry: () => void preview.refetch(),
    model: data && {
      title: `${data.request.targetLabel} request`,
      requesterName: data.request.requester.name,
      requesterEmail: data.request.requester.email,
      reason: data.request.reason,
      pending,
      decided,
      permission,
      usageLimit: data.resolutionKind === 'usage_limit',
      canApply: data.canApply,
      alreadyAvailable: permission && data.canApply && data.changes.length === 0,
      groupName: data.group?.name ?? DESCRIBE_FALLBACK,
      currentLimit: data.currentLimitCredits,
      newLimit: data.newLimitCredits,
      fulfilled: data.request.status === 'fulfilled',
      unavailableReason: data.unavailableReason,
      decision:
        data.request.status === 'pending'
          ? null
          : `${ACCESS_REQUEST_STATUS_LABELS[data.request.status]}${data.request.decisionReason ? `: ${data.request.decisionReason}` : ''}`,
      workspaces: data.impact.workspaceNames.length
        ? `${data.impact.workspaceNames.join(', ')}${data.impact.truncated ? ' and more' : ''}`
        : null,
      changes: data.changes.map((change) => ({
        key: change.configKey,
        label: change.label,
        summary: describePolicyChange(change, data.request.target, data.request.targetLabel),
        before: describePolicyValue(
          change.before,
          change.configKey,
          data.request.target,
          data.request.targetLabel
        ),
        after: describePolicyValue(
          change.after,
          change.configKey,
          data.request.target,
          data.request.targetLabel
        ),
      })),
    },
    isValidLimit: (limit: number) =>
      Number.isSafeInteger(limit) && limit > (data?.currentLimitCredits ?? 0),
    /** Resolves with the sentence the tray reports. */
    apply: async (newLimitCredits: number | null) => {
      if (!data) return ''
      const { request } = await resolve.mutateAsync({
        organizationId,
        requestId,
        body: {
          action: 'apply',
          expectedFingerprint: data.fingerprint,
          ...(data.resolutionKind === 'usage_limit' && newLimitCredits !== null
            ? { newLimitCredits }
            : {}),
        },
      })
      if (request.status !== 'fulfilled')
        return `Request ${ACCESS_REQUEST_STATUS_LABELS[request.status].toLowerCase()}`
      return request.target.kind === 'usage_limit' ? 'Credit limit increased' : 'Access granted'
    },
    decline: async (reason: string) => {
      const { request } = await resolve.mutateAsync({
        organizationId,
        requestId,
        body: { action: 'decline', reason: reason.trim() },
      })
      return `Request ${ACCESS_REQUEST_STATUS_LABELS[request.status].toLowerCase()}`
    },
  }
}
