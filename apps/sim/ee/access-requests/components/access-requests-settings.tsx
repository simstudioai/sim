'use client'

import { Chip, ChipSwitch, ChipTag } from '@sim/emcn'
import { Lock } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { SettingsPanel } from '@/components/settings/settings-panel'
import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { MyAccessRequestDetails } from '@/ee/access-requests/components/my-access-request-details'
import { OrganizationAccessRequests } from '@/ee/access-requests/components/organization-access-requests'
import { RequestAccessAction } from '@/ee/access-requests/components/request-access-action'
import {
  accessRequestSettingsSearchParams,
  accessRequestUrlOptions,
} from '@/ee/access-requests/components/search-params'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/ee/access-requests/components/status'
import { ACCESS_REQUEST_MAX_SEARCH_LENGTH } from '@/ee/access-requests/lib/constants'
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useDiscoverAccessRequests,
  useMyAccessRequests,
} from '@/hooks/queries/access-requests'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface AccessRequestsSettingsProps {
  scope: AccessRequestScope
  reviewOrganizationId?: string
  standalone?: boolean
}

export function AccessRequestsSettings({
  scope,
  reviewOrganizationId,
  standalone = false,
}: AccessRequestsSettingsProps) {
  const router = useRouter()
  const actions = standalone
    ? [{ text: 'Back to Sim', onSelect: () => router.push(APP_ENTRY_PATH) }]
    : undefined
  const [{ view: selectedView, search, page, requestId }, setParams] = useQueryStates(
    accessRequestSettingsSearchParams,
    accessRequestUrlOptions
  )
  const view =
    selectedView === 'review' && !reviewOrganizationId
      ? 'requests'
      : (selectedView ?? (reviewOrganizationId ? 'review' : 'requests'))
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ search: value, page: 0 }, options)
  )
  const debouncedSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const searchPending = view === 'catalog' && search.trim() !== debouncedSearch
  const offset = page * ACCESS_REQUEST_PAGE_SIZE
  const requests = useMyAccessRequests(scope, offset, undefined, view === 'requests')
  const catalog = useDiscoverAccessRequests({
    ...scope,
    search: view === 'catalog' ? debouncedSearch : '',
    state: 'requestable',
    limit: view === 'catalog' ? ACCESS_REQUEST_PAGE_SIZE : 1,
    offset: view === 'catalog' ? offset : 0,
  })
  const currentQuery = view === 'requests' ? requests : catalog
  const showCatalog =
    view === 'catalog' ||
    (catalog.isSuccess && catalog.data.enabled && catalog.data.entries.length > 0)
  const requestsPaused =
    catalog.isSuccess && !catalog.data.enabled && Boolean(catalog.data.organizationId)
  return (
    <div className='flex flex-col gap-7'>
      {(showCatalog || reviewOrganizationId) && (
        <ChipSwitch
          aria-label='Access request views'
          options={[
            { value: 'requests', label: 'My requests' },
            ...(showCatalog ? [{ value: 'catalog' as const, label: 'Browse access' }] : []),
            ...(reviewOrganizationId
              ? [{ value: 'review' as const, label: 'Review requests' }]
              : []),
          ]}
          value={view}
          onChange={(value) =>
            void setParams({ view: value, page: 0, requestId: null, 'request-id': null })
          }
        />
      )}
      {view === 'review' && reviewOrganizationId ? (
        <OrganizationAccessRequests organizationId={reviewOrganizationId} actions={actions} />
      ) : (
        <SettingsPanel
          actions={actions}
          search={
            view === 'catalog' && catalog.data?.enabled
              ? {
                  value: search,
                  onChange: setSearch,
                  placeholder: 'Search features, integrations, and models...',
                  maxLength: ACCESS_REQUEST_MAX_SEARCH_LENGTH,
                }
              : undefined
          }
        >
          {view === 'requests' && requestsPaused && (
            <p className='text-[var(--text-muted)] text-sm'>
              Your organization has paused new requests. Your request history is still available.
            </p>
          )}
          {searchPending || currentQuery.isPending ? (
            <SettingsEmptyState variant='inline'>
              <span role='status'>Loading...</span>
            </SettingsEmptyState>
          ) : currentQuery.isError ? (
            <SettingsQueryErrorState
              variant='inline'
              error={currentQuery.error}
              fallback='Unable to load access requests'
              isRetrying={currentQuery.isFetching}
              onRetry={() => void currentQuery.refetch()}
            />
          ) : view === 'requests' ? (
            <div className={RESOURCE_LIST_STACK}>
              {requests.data?.requests.length === 0 && (
                <SettingsEmptyState variant='inline'>
                  {page > 0
                    ? 'No requests on this page. Go to the previous page to see your requests.'
                    : 'No requests yet. Requests you send will appear here.'}
                </SettingsEmptyState>
              )}
              {requests.data?.requests.map((request) => (
                <SettingsResourceRow
                  key={request.id}
                  title={request.targetLabel}
                  description={new Date(request.createdAt).toLocaleDateString()}
                  badge={
                    <ChipTag variant='gray'>{ACCESS_REQUEST_STATUS_LABELS[request.status]}</ChipTag>
                  }
                  onClick={() => void setParams({ requestId: request.id }, { history: 'push' })}
                  clickLabel={`View request for ${request.targetLabel}`}
                />
              ))}
            </div>
          ) : !catalog.data?.enabled ? (
            <SettingsEmptyState variant='inline'>
              {requestsPaused
                ? 'Your organization has paused new requests. Your request history is still available.'
                : 'Access requests are available in organization workspaces.'}
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {catalog.data.entries.length === 0 && (
                <SettingsEmptyState variant='inline'>
                  <div className='flex flex-col items-center gap-2'>
                    <span>
                      {debouncedSearch
                        ? 'No matching results. Try another search.'
                        : page > 0
                          ? 'No more access to request.'
                          : `Nothing to request in this ${scope.kind}.`}
                    </span>
                    {debouncedSearch && <Chip onClick={() => setSearch('')}>Clear search</Chip>}
                  </div>
                </SettingsEmptyState>
              )}
              {catalog.data.entries.map((entry) => (
                <SettingsResourceRow
                  key={JSON.stringify(entry.target)}
                  icon={entry.state === 'allowed' ? undefined : <Lock />}
                  iconVariant='plain'
                  title={entry.label}
                  badge={
                    entry.state === 'allowed' ? (
                      <ChipTag variant='gray'>Available</ChipTag>
                    ) : undefined
                  }
                  trailing={
                    entry.state === 'requestable' ? (
                      <RequestAccessAction
                        scope={scope}
                        target={entry.target}
                        label={entry.label}
                        pendingRequestId={entry.pendingRequestId}
                        onViewRequest={(requestId) =>
                          void setParams({ requestId }, { history: 'push' })
                        }
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
          {(page > 0 || currentQuery.data?.hasMore) && (
            <div className='flex items-center justify-between gap-2'>
              <Chip
                disabled={page === 0 || currentQuery.isFetching || searchPending}
                onClick={() => void setParams({ page: page - 1 })}
              >
                Previous
              </Chip>
              <span className='text-[var(--text-muted)] text-sm'>Page {page + 1}</span>
              <Chip
                disabled={!currentQuery.data?.hasMore || currentQuery.isFetching || searchPending}
                onClick={() => void setParams({ page: page + 1 })}
              >
                Next
              </Chip>
            </div>
          )}
          {requestId && (
            <MyAccessRequestDetails
              key={JSON.stringify([scope, requestId])}
              scope={scope}
              requestId={requestId}
              onClose={() => void setParams({ requestId: null })}
            />
          )}
        </SettingsPanel>
      )}
    </div>
  )
}
