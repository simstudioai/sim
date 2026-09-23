import { omit } from '@sim/utils/object'
import { createLoader, createSerializer } from 'nuqs/server'
import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  accessRequestEntrySearchParams,
  accessRequestSettingsSearchParams,
  accessReviewSearchParams,
} from '@/ee/access-requests/components/search-params'

const loadEntrySearchParams = createLoader(accessRequestEntrySearchParams)
const serializeSettingsSearchParams = createSerializer({
  ...accessReviewSearchParams,
  ...accessRequestSettingsSearchParams,
})

export function getAccessRequestsSettingsHref(scope: AccessRequestScope): string {
  return scope.kind === 'workspace'
    ? `/workspace/${encodeURIComponent(scope.workspaceId)}/settings/requests`
    : organizationRoutes(scope.organizationId).settingsSection('requests')
}

/** Organization links use the entry resolver so they also work outside the Search rollout. */
export function getMyAccessRequestHref(scope: AccessRequestScope, requestId: string): string {
  const pathname =
    scope.kind === 'workspace' ? getAccessRequestsSettingsHref(scope) : '/access-requests'
  const query = serializeSettingsSearchParams({ view: 'requests', requestId })
  const params = new URLSearchParams(query)
  if (scope.kind === 'organization') params.set('organizationId', scope.organizationId)
  return `${pathname}?${params}`
}

/** Moves requester and email links into settings without changing their selected view or scope. */
export function getLegacyAccessRequestsSettingsQuery(
  searchParams: Record<string, string | string[] | undefined>
): string {
  const params = loadEntrySearchParams(searchParams)
  const review = params.view === 'admin' || params.view === 'review'
  return serializeSettingsSearchParams({
    view: review ? 'review' : params.view === 'catalog' ? 'catalog' : 'requests',
    search: params.search,
    page: params.page,
    requestId: review ? null : params.requestId,
    'request-id': review ? (params['request-id'] ?? params.requestId) : null,
    'request-search': params['request-search'],
    'request-page': params['request-page'],
    'request-status': params['request-status'],
  })
}

const loadReviewSearchParams = createLoader(accessReviewSearchParams)
const serializeReviewSearchParams = createSerializer(
  omit(accessReviewSearchParams, ['access-view'])
)

/** Preserves review state when a saved Permission groups tab URL moves to Requests. */
export function getLegacyAccessRequestsQuery(
  section: string,
  searchParams: Record<string, string | string[] | undefined>
): URLSearchParams | null {
  if (section !== 'access-control') return null
  const params = loadReviewSearchParams(searchParams)
  return params['access-view'] === 'requests'
    ? new URLSearchParams(serializeReviewSearchParams(params))
    : null
}
