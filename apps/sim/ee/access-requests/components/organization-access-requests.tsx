'use client'

import { Chip, ChipInput, ChipSelect, ChipSwitch, ChipTag, toast } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { AccessRequestReview } from '@/ee/access-requests/components/access-request-review'
import {
  accessRequestUrlOptions,
  accessReviewSearchParams,
} from '@/ee/access-requests/components/search-params'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/ee/access-requests/components/status'
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useAccessRequestSettings,
  useOrganizationAccessRequests,
  useUpdateAccessRequestSettings,
} from '@/ee/access-requests/hooks/access-requests'
import { ACCESS_REQUEST_MAX_SEARCH_LENGTH } from '@/ee/access-requests/lib/constants'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface OrganizationAccessRequestsProps {
  organizationId: string
  standalone?: boolean
}

export function OrganizationAccessRequests({
  organizationId,
  standalone = false,
}: OrganizationAccessRequestsProps) {
  const [params, setParams] = useQueryStates(accessReviewSearchParams, {
    ...accessRequestUrlOptions,
    urlKeys: { 'request-id': standalone ? 'requestId' : 'request-id' },
  })
  const searchTerm = params['request-search']
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setParams({ 'request-search': value, 'request-page': 0 }, options)
  )
  const debouncedSearch = useDebounce(searchTerm.trim(), SEARCH_DEBOUNCE_MS)
  const searchPending = searchTerm.trim() !== debouncedSearch
  const page = params['request-page']
  const requests = useOrganizationAccessRequests(
    organizationId,
    page * ACCESS_REQUEST_PAGE_SIZE,
    params['request-status'],
    debouncedSearch
  )
  const settings = useAccessRequestSettings(organizationId)
  const updateSettings = useUpdateAccessRequestSettings(organizationId)
  const status = params['request-status']
  const requestLabel =
    status === 'all' ? 'Requests' : `${ACCESS_REQUEST_STATUS_LABELS[status]} requests`
  const requestCount = !searchPending && !requests.isError ? requests.data?.total : undefined

  const content = (
    <div className='flex flex-col gap-7'>
      {settings.isPending ? (
        <SettingsEmptyState variant='inline'>Loading request settings...</SettingsEmptyState>
      ) : settings.isError ? (
        <SettingsQueryErrorState
          variant='inline'
          error={settings.error}
          fallback='Unable to load request settings'
          isRetrying={settings.isFetching}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <SettingsResourceRow
          title='Allow requests'
          description={
            settings.data.allowRequests === false
              ? 'New requests and approvals are paused. You can still view history and decline pending requests.'
              : 'People can send requests for administrators to review.'
          }
          trailing={
            <ChipSwitch
              aria-label='Allow requests'
              size='compact'
              options={[
                { value: 'enabled', label: 'Enabled' },
                { value: 'paused', label: 'Paused' },
              ]}
              value={settings.data.allowRequests ? 'enabled' : 'paused'}
              onChange={(value) =>
                updateSettings.mutate(value === 'enabled', {
                  onError: (error) => toast.error(error.message),
                })
              }
              disabled={updateSettings.isPending}
            />
          }
        />
      )}
      <SettingsSection
        label={requestCount === undefined ? requestLabel : `${requestLabel} (${requestCount})`}
        action={
          <ChipSelect
            showSelectedCheck
            dropdownWidth='trigger'
            modal={false}
            className='w-auto max-w-none'
            value={params['request-status']}
            onChange={(value) =>
              void setParams({
                'request-status': value as (typeof params)['request-status'],
                'request-page': 0,
              })
            }
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'fulfilled', label: ACCESS_REQUEST_STATUS_LABELS.fulfilled },
              { value: 'declined', label: 'Declined' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'closed', label: 'Closed' },
              { value: 'all', label: 'All requests' },
            ]}
            aria-label='Filter request status'
          />
        }
      >
        {searchPending || requests.isPending ? (
          <SettingsEmptyState variant='inline'>
            <span role='status'>Loading requests...</span>
          </SettingsEmptyState>
        ) : requests.isError ? (
          <SettingsQueryErrorState
            variant='inline'
            error={requests.error}
            fallback='Unable to load requests'
            isRetrying={requests.isFetching}
            onRetry={() => void requests.refetch()}
          />
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {requests.data.requests.length === 0 && (
              <SettingsEmptyState variant='inline'>
                {debouncedSearch
                  ? `No matching requests for "${debouncedSearch}".`
                  : status === 'pending'
                    ? 'No pending requests. Requests that need your review will appear here.'
                    : status === 'all'
                      ? 'No requests yet. Requests will appear here once someone sends one.'
                      : `No ${ACCESS_REQUEST_STATUS_LABELS[status].toLowerCase()} requests.`}
              </SettingsEmptyState>
            )}
            {requests.data.requests.map((request) => (
              <SettingsResourceRow
                key={request.id}
                title={request.targetLabel}
                description={`${request.requester.name || request.requester.email} · ${new Date(request.createdAt).toLocaleDateString()}`}
                badge={
                  <ChipTag variant='gray'>{ACCESS_REQUEST_STATUS_LABELS[request.status]}</ChipTag>
                }
                onClick={() => void setParams({ 'request-id': request.id }, { history: 'push' })}
                clickLabel={`Review ${request.targetLabel} request from ${request.requester.name || request.requester.email}`}
                navigable
              />
            ))}
          </div>
        )}
        {!searchPending && (page > 0 || requests.data?.hasMore) && (
          <div className='mt-5 flex items-center justify-between'>
            <Chip
              disabled={page === 0 || requests.isFetching}
              onClick={() => void setParams({ 'request-page': page - 1 })}
            >
              Previous
            </Chip>
            <span className='text-[var(--text-muted)] text-sm'>Page {page + 1}</span>
            <Chip
              disabled={!requests.data?.hasMore || requests.isFetching}
              onClick={() => void setParams({ 'request-page': page + 1 })}
            >
              Next
            </Chip>
          </div>
        )}
      </SettingsSection>
      {params['request-id'] && (
        <AccessRequestReview
          key={params['request-id']}
          organizationId={organizationId}
          requestId={params['request-id']}
          onClose={() => void setParams({ 'request-id': null })}
        />
      )}
    </div>
  )

  const search = {
    value: searchTerm,
    onChange: setSearchTerm,
    placeholder: 'Search requests...',
    maxLength: ACCESS_REQUEST_MAX_SEARCH_LENGTH,
  }

  return standalone ? (
    <div className='flex flex-col gap-7'>
      <ChipInput
        icon={Search}
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={search.placeholder}
        maxLength={search.maxLength}
        aria-label='Search requests'
        autoComplete='off'
      />
      {content}
    </div>
  ) : (
    <SettingsPanel search={search}>{content}</SettingsPanel>
  )
}
