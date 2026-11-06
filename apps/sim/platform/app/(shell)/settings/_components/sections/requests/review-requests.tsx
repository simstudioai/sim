'use client'

import { toast } from '@sim/emcn'
import { ACCESS_REQUEST_MAX_SEARCH_LENGTH } from '@/ee/access-requests/lib/constants'
import styles from '@/platform/app/(shell)/settings/_components/sections/requests/requests.module.css'
import { ReviewModal } from '@/platform/app/(shell)/settings/_components/sections/requests/review-modal'
import {
  Button,
  EmptyState,
  errorMessageOr,
  Pagination,
  QueryBoundary,
  SectionSearch,
  Select,
  StatusTag,
  Switch,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  REQUEST_STATUS_OPTIONS,
  type RequestStatusFilter,
  useRequestsUrl,
  useReviewList,
} from '@/platform/lib/data/requests'

interface ReviewRequestsProps {
  organizationId: string
}

function emptyTitle(query: string, status: RequestStatusFilter, statusLabel: string | null) {
  if (query) return `No matching requests for "${query}"`
  if (status === 'pending') return 'No pending requests'
  if (status === 'all') return 'No requests yet'
  return `No ${statusLabel?.toLowerCase()} requests`
}

export function ReviewRequests({ organizationId }: ReviewRequestsProps) {
  const list = useReviewList(organizationId)
  const { params, setParams } = useRequestsUrl(true)
  const { settings } = list
  const reviewId = params['request-id']
  return (
    <>
      <SectionSearch
        subject='requests'
        value={list.search}
        onValueChange={list.setSearch}
        maxLength={ACCESS_REQUEST_MAX_SEARCH_LENGTH}
      />
      <QueryBoundary
        query={{
          data: settings.loading || settings.error ? undefined : true,
          error: settings.loading ? undefined : settings.error,
          isFetching: settings.fetching,
          refetch: settings.retry,
        }}
        failure={errorMessageOr('The settings are unavailable.')}
        failureTitle='Unable to load request settings'
        loadingLabel='Loading request settings…'
        rows={1}
      >
        {() => (
          <SettingsSurface>
            <SettingsRow
              label='Allow requests'
              description={
                settings.allowed
                  ? 'People can send requests for administrators to review.'
                  : 'New requests and approvals are paused. You can still view history and decline pending requests.'
              }
            >
              <Switch
                label='Allow requests'
                checked={settings.allowed}
                disabled={settings.updating}
                onCheckedChange={(next) =>
                  settings.update(next).catch((error: Error) => toast.error(error.message))
                }
              />
            </SettingsRow>
          </SettingsSurface>
        )}
      </QueryBoundary>
      <div className={styles.listHeading}>
        <h2 data-type='T042'>{list.count === undefined ? 'Requests' : `Requests ${list.count}`}</h2>
        <span className={styles.filter}>
          <Select
            variant='quiet'
            label='Filter request status'
            options={REQUEST_STATUS_OPTIONS}
            value={list.status}
            onValueChange={(next) =>
              list.setStatus(
                REQUEST_STATUS_OPTIONS.find((option) => option.value === next)?.value ?? 'pending'
              )
            }
          />
        </span>
      </div>
      <QueryBoundary
        query={{
          data: list.searching || list.loading || list.error ? undefined : list.rows,
          error: list.searching || list.loading ? undefined : list.error,
          isFetching: list.fetching,
          refetch: list.retry,
        }}
        failure={errorMessageOr('The requests are unavailable.')}
        failureTitle='Unable to load requests'
        loadingLabel='Loading requests…'
      >
        {() =>
          list.rows.length === 0 ? (
            <EmptyState title={emptyTitle(list.query, list.status, list.statusLabel)} />
          ) : (
            <SettingsSurface>
              {list.rows.map((row) => (
                <SettingsRow key={row.id} label={row.title} description={row.detail}>
                  <span className={styles.controls}>
                    <StatusTag label={row.status.label} intent={row.status.intent} />
                    <Button
                      size='compact'
                      variant='quiet'
                      onClick={() => void setParams({ 'request-id': row.id }, { history: 'push' })}
                    >
                      Review
                    </Button>
                  </span>
                </SettingsRow>
              ))}
            </SettingsSurface>
          )
        }
      </QueryBoundary>
      {!list.searching && (list.page > 0 || list.hasMore) && (
        <Pagination
          label='Request pages'
          page={list.page + 1}
          hasNext={list.hasMore}
          disabled={list.fetching}
          onPageChange={(next) => list.setPage(next - 1)}
        />
      )}
      {reviewId && (
        <ReviewModal
          key={reviewId}
          organizationId={organizationId}
          requestId={reviewId}
          onClose={() => void setParams({ 'request-id': null })}
        />
      )}
    </>
  )
}
