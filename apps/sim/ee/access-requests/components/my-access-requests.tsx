'use client'

import { Chip, ChipInput, ChipLink, ChipSwitch, ChipTag } from '@sim/emcn'
import { Lock, Search } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'
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
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useDiscoverAccessRequests,
  useMyAccessRequests,
} from '@/ee/access-requests/hooks/access-requests'
import { ACCESS_REQUEST_MAX_SEARCH_LENGTH } from '@/ee/access-requests/lib/constants'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface MyAccessRequestsProps {
  scope: AccessRequestScope
}

export function MyAccessRequests({ scope }: MyAccessRequestsProps) {
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
  const catalog = useDiscoverAccessRequests(
    {
      ...scope,
      search: debouncedSearch,
      state: 'requestable',
      limit: ACCESS_REQUEST_PAGE_SIZE,
      offset,
    },
    view === 'catalog'
  )
  const currentQuery = view === 'requests' ? requests : catalog

  return (
    <main className='flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg)]'>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8'>
        <div className='flex items-start justify-between gap-4'>
          <div className='space-y-1'>
            <h1 className='text-[var(--text-primary)] text-lg'>My access requests</h1>
          </div>
          {scope.kind === 'organization' && (
            <ChipLink href={WORKSPACES_PATH}>Your workspaces</ChipLink>
          )}
        </div>
        <ChipSwitch
          aria-label='Access request views'
          options={[
            { value: 'requests', label: 'My requests' },
            { value: 'catalog', label: 'Browse access' },
          ]}
          value={view}
          onChange={(value) => void setParams({ view: value, page: 0, requestId: null })}
        />
        {view === 'catalog' && (
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
                title='No access requests yet'
                description='Browse access to find a feature you need.'
                action={
                  <Chip
                    onClick={() => void setParams({ view: 'catalog', page: 0, requestId: null })}
                  >
                    Browse access
                  </Chip>
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
                navigable
              />
            ))}
          </div>
        ) : !catalog.data?.enabled ? (
          <EmptyState
            title='Access requests are unavailable'
            description='Your organization is not accepting new requests.'
          />
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {catalog.data.entries.length === 0 && (
              <EmptyState
                title='No matching access'
                description='Try searching for another feature or integration.'
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
