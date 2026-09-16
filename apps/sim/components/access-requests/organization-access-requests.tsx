'use client'

import { Chip, ChipDropdown, ChipSwitch, ChipTag, toast } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { AccessRequestReview } from '@/components/access-requests/access-request-review'
import {
  accessRequestUrlOptions,
  accessReviewSearchParams,
} from '@/components/access-requests/search-params'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/components/access-requests/status'
import { EmptyState } from '@/components/empty-state/empty-state'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useAccessRequestSettings,
  useOrganizationAccessRequests,
  useUpdateAccessRequestSettings,
} from '@/hooks/queries/access-requests'

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
  const page = params['request-page']
  const requests = useOrganizationAccessRequests(
    organizationId,
    page * ACCESS_REQUEST_PAGE_SIZE,
    params['request-status']
  )
  const settings = useAccessRequestSettings(organizationId)
  const updateSettings = useUpdateAccessRequestSettings(organizationId)

  return (
    <div className='flex flex-col gap-5'>
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
          title='Allow users to request permissions'
          description={
            settings.data.allowRequests === false
              ? 'New requests and approvals are paused.'
              : 'Includes access and credit limit requests.'
          }
          trailing={
            <ChipSwitch
              aria-label='Allow users to request permissions'
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
      <div className='flex items-center justify-between gap-2'>
        <h2 className='text-[var(--text-body)] text-sm'>Requests</h2>
        <ChipDropdown
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
      </div>
      {requests.isPending ? (
        <p className='text-[var(--text-muted)] text-sm' role='status'>
          Loading requests...
        </p>
      ) : requests.isError ? (
        <EmptyState
          title='Unable to load requests'
          description={requests.error.message}
          action={<Chip onClick={() => void requests.refetch()}>Try again</Chip>}
        />
      ) : (
        <div className={RESOURCE_LIST_STACK}>
          {requests.data.requests.length === 0 && (
            <EmptyState
              title='No access requests'
              description='Requests from your members will appear here.'
            />
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
      {(page > 0 || requests.data?.hasMore) && (
        <div className='flex items-center justify-between'>
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
}
