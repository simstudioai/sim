'use client'

import { useRef } from 'react'
import {
  Chip,
  ChipInput,
  ChipLink,
  ChipSwitch,
  ChipTag,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { Lock, Search } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { MyAccessRequestDetails } from '@/ee/access-requests/components/my-access-request-details'
import { RequestAccessAction } from '@/ee/access-requests/components/request-access-action'
import {
  accessRequestSearchParams,
  accessRequestUrlOptions,
} from '@/ee/access-requests/components/search-params'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/ee/access-requests/components/status'
import { ACCESS_REQUEST_MAX_SEARCH_LENGTH } from '@/ee/access-requests/lib/constants'
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useDiscoverAccessRequests,
  useMyAccessRequests,
} from '@/hooks/queries/access-requests'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface MyAccessRequestsProps {
  scope: AccessRequestScope
  standalone?: boolean
}

export function MyAccessRequests({ scope, standalone = false }: MyAccessRequestsProps) {
  const scrollRef = useRef<HTMLElement>(null)
  const scrollEdges = useScrollEdges(scrollRef)
  const { hosted } = useDeploymentShape()
  const workspace = useWorkspaceHostContextQuery(
    scope.kind === 'workspace' ? scope.workspaceId : ''
  )
  const [{ view, search, page, requestId }, setParams] = useQueryStates(
    accessRequestSearchParams,
    accessRequestUrlOptions
  )
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
  const scopeLabel =
    scope.kind === 'workspace'
      ? `Workspace: ${workspace.isSuccess ? workspace.data.workspace.name : 'Current workspace'}`
      : 'Organization requests'

  return (
    <main
      ref={scrollRef}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg)] py-8',
        scrollFadeClass
      )}
      {...scrollFadeAttributes(scrollEdges)}
    >
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-6'>
        <div className='flex items-start justify-between gap-4'>
          <div className='space-y-1'>
            <h1 className='text-[var(--text-primary)] text-lg'>My access requests</h1>
            <p className='text-[var(--text-muted)] text-sm'>{scopeLabel}</p>
            {hosted && scope.kind === 'workspace' && workspace.data?.hostOrganizationId && (
              <p className='text-[var(--text-muted)] text-sm'>
                Includes your organization credit limit requests.
              </p>
            )}
          </div>
          {standalone && <ChipLink href={APP_ENTRY_PATH}>Back to Sim</ChipLink>}
        </div>
        {showCatalog && (
          <ChipSwitch
            aria-label='Access request views'
            options={[
              { value: 'requests', label: 'My requests' },
              { value: 'catalog', label: 'Browse access' },
            ]}
            value={view}
            onChange={(value) => void setParams({ view: value, page: 0, requestId: null })}
          />
        )}
        {view === 'requests' && requestsPaused && (
          <p className='text-[var(--text-muted)] text-sm'>
            Your organization has paused new requests. Your request history is still available.
          </p>
        )}
        {view === 'catalog' && catalog.isSuccess && catalog.data.enabled && (
          <ChipInput
            icon={Search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={ACCESS_REQUEST_MAX_SEARCH_LENGTH}
            placeholder='Search features, integrations, and models...'
            aria-label='Search access catalog'
          />
        )}
        {searchPending || currentQuery.isPending ? (
          <p className='text-[var(--text-muted)] text-sm' role='status'>
            Loading...
          </p>
        ) : currentQuery.isError ? (
          <EmptyState
            title='Unable to load access requests'
            description={currentQuery.error.message}
            action={<Chip onClick={() => void currentQuery.refetch()}>Try again</Chip>}
          />
        ) : view === 'requests' ? (
          <div className={RESOURCE_LIST_STACK}>
            {requests.data?.requests.length === 0 && (
              <EmptyState
                title={page > 0 ? 'No requests on this page' : 'No access requests yet'}
                description={
                  page > 0
                    ? 'Go to the previous page to see your requests.'
                    : 'Requests you send appear here so you can track their status.'
                }
              />
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
          <EmptyState
            title={requestsPaused ? 'New requests are paused' : 'Access requests are unavailable'}
            description={
              requestsPaused
                ? 'Your organization has paused new requests. You can still view your request history.'
                : 'Access requests are available in organization workspaces.'
            }
          />
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {catalog.data.entries.length === 0 && (
              <EmptyState
                title={
                  debouncedSearch
                    ? 'No matching results'
                    : page > 0
                      ? 'No more access to request'
                      : `Nothing to request in this ${scope.kind}`
                }
                description={
                  debouncedSearch
                    ? 'Try another search or clear it to see available requests.'
                    : page > 0
                      ? 'Go to the previous page to see available requests.'
                      : 'There is no additional access available to request.'
                }
                action={
                  debouncedSearch ? (
                    <Chip onClick={() => setSearch('')}>Clear search</Chip>
                  ) : undefined
                }
              />
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
      </div>
      {requestId && (
        <MyAccessRequestDetails
          key={JSON.stringify([scope, requestId])}
          scope={scope}
          requestId={requestId}
          onClose={() => void setParams({ requestId: null })}
        />
      )}
    </main>
  )
}
