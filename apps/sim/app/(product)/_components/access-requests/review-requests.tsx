'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Pagination } from '@sim/emcn/pagination'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection, SettingsSurface } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { toast } from '@/lib/toast/sink'
import styles from '@/app/(product)/_components/access-requests/access-requests.module.css'
import { ReviewModal } from '@/app/(product)/_components/access-requests/review-modal'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SectionToolbar } from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
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
  if (query) return 'No matching requests'
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
      {settings.loading ? null : settings.error ? (
        <FailureNotice
          title='Unable to load request settings'
          message={settings.error.message}
          retrying={settings.fetching}
          onRetry={settings.retry}
        />
      ) : (
        <SettingsSurface>
          <SwitchRow
            label='Allow requests'
            description={
              settings.allowed
                ? 'Members can ask for access to workspaces and integrations'
                : 'New requests and approvals are paused; you can still view history and decline pending requests'
            }
            checked={settings.allowed}
            disabled={settings.updating}
            onCheckedChange={(next) =>
              settings.update(next).catch((error: Error) => toast.error(error.message))
            }
          />
        </SettingsSurface>
      )}
      <SectionToolbar
        grow={
          (list.rows.length > 0 || Boolean(list.query)) && (
            <SearchField
              label='Search requests'
              placeholder='Search requests…'
              value={list.search}
              onValueChange={list.setSearch}
            />
          )
        }
      >
        <ChoiceMenu
          label='Filter request status'
          options={REQUEST_STATUS_OPTIONS}
          value={list.status}
          onValueChange={(next) =>
            list.setStatus(
              REQUEST_STATUS_OPTIONS.find((option) => option.value === next)?.value ?? 'pending'
            )
          }
        />
      </SectionToolbar>
      {list.searching || list.loading ? (
        <SettingsSection title='Requests' />
      ) : list.error ? (
        <FailureNotice
          title='Unable to load requests'
          message={list.error.message}
          retrying={list.fetching}
          onRetry={list.retry}
        />
      ) : (
        <SettingsList
          title='Requests'
          empty={
            list.rows.length === 0
              ? {
                  title: emptyTitle(list.query, list.status, list.statusLabel),
                  description: list.query
                    ? undefined
                    : list.status === 'pending'
                      ? 'Requests that need your review will appear here'
                      : list.status === 'all'
                        ? 'Requests will appear here once someone sends one'
                        : undefined,
                }
              : undefined
          }
        >
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
        </SettingsList>
      )}
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
