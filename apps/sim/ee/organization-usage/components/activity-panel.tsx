'use client'

import { Chip, ChipDropdown } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  ACTIVITY_MAX_PAGE,
  type ActivityDimension,
  type ActivitySort,
} from '@/lib/billing/core/organization-activity'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { ActivitySummary } from '@/ee/organization-usage/components/activity-summary'
import { ActivityTable } from '@/ee/organization-usage/components/activity-table'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import {
  useOrganizationActivityBreakdown,
  useOrganizationActivitySummary,
} from '@/hooks/queries/organization-activity'

const DIMENSIONS = [
  { value: 'workspace', label: 'Workspaces' },
  { value: 'workflow', label: 'Workflows' },
  { value: 'member', label: 'Members' },
  { value: 'trigger', label: 'Triggers' },
]
const SORTS = [
  { value: 'runs', label: 'Most runs' },
  { value: 'failures', label: 'Most failures' },
  { value: 'duration', label: 'Longest duration' },
]

interface ActivityPanelProps {
  organizationId: string
}

export function ActivityPanel({ organizationId }: ActivityPanelProps) {
  const { window, workspace, activityDimension, activitySort, activityPage, setState } =
    useUsageWindow()
  const options = { workspaceId: workspace ?? undefined }
  const sort = activityDimension === 'member' ? 'runs' : activitySort
  const summary = useOrganizationActivitySummary(organizationId, window, options)
  const breakdown = useOrganizationActivityBreakdown(
    organizationId,
    window,
    activityDimension,
    sort,
    activityPage,
    options
  )
  if (workspace && isApiClientError(summary.error) && summary.error.status === 404) {
    return (
      <SettingsEmptyState variant='inline'>
        Workspace unavailable.
        <Chip
          onClick={() =>
            void setState({ workspace: null, activityDimension: 'workspace', activityPage: 0 })
          }
        >
          All workspaces
        </Chip>
      </SettingsEmptyState>
    )
  }
  return (
    <>
      {workspace && (
        <div className='flex flex-wrap items-center gap-2'>
          <Chip
            leftIcon={ArrowLeft}
            onClick={() =>
              void setState({ workspace: null, activityDimension: 'workspace', activityPage: 0 })
            }
          >
            All workspaces
          </Chip>
          <span className='text-[var(--text-body)] text-small'>
            {summary.data?.workspace?.name ?? 'Workspace activity'}
          </span>
        </div>
      )}
      <SettingsSection label='Activity'>
        <ActivitySummary
          summary={summary.data}
          loading={summary.isPending}
          error={summary.isError}
          onRetry={() => void summary.refetch()}
        />
      </SettingsSection>
      <SettingsSection label='Breakdown'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <ChipDropdown
              matchTriggerWidth={false}
              className='max-w-full'
              options={DIMENSIONS}
              value={activityDimension}
              onChange={(value) =>
                void setState({ activityDimension: value as ActivityDimension, activityPage: 0 })
              }
              aria-label='Group activity by'
            />
            {activityDimension !== 'member' && (
              <ChipDropdown
                matchTriggerWidth={false}
                className='max-w-full'
                options={SORTS}
                value={sort}
                onChange={(value) =>
                  void setState({ activitySort: value as ActivitySort, activityPage: 0 })
                }
                aria-label='Sort activity by'
                align='end'
              />
            )}
          </div>
          {breakdown.isError ? (
            <SettingsEmptyState variant='inline' tone='error'>
              Couldn't load the breakdown.{' '}
              <Chip onClick={() => void breakdown.refetch()}>Retry</Chip>
            </SettingsEmptyState>
          ) : !breakdown.data ? (
            <SettingsEmptyState variant='inline'>Loading breakdown…</SettingsEmptyState>
          ) : breakdown.data.rows.length === 0 ? (
            <SettingsEmptyState variant='inline'>No activity in this period.</SettingsEmptyState>
          ) : (
            <ActivityTable
              rows={breakdown.data.rows}
              dimension={activityDimension}
              onSelectWorkspace={(id) =>
                void setState(
                  { workspace: id, activityDimension: 'workflow', activityPage: 0 },
                  { history: 'push' }
                )
              }
            />
          )}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            {(activityPage > 0 || breakdown.data?.hasMore) && (
              <div className='flex shrink-0 items-center gap-1'>
                <Chip
                  disabled={activityPage === 0 || breakdown.isLoading}
                  onClick={() => void setState({ activityPage: activityPage - 1 })}
                >
                  Previous
                </Chip>
                <span
                  className='text-[var(--text-muted)] text-caption tabular-nums'
                  aria-live='polite'
                >
                  {activityPage + 1}
                </span>
                <Chip
                  disabled={
                    !breakdown.data?.hasMore ||
                    breakdown.isLoading ||
                    activityPage >= ACTIVITY_MAX_PAGE
                  }
                  onClick={() => void setState({ activityPage: activityPage + 1 })}
                >
                  Next
                </Chip>
              </div>
            )}
          </div>
        </div>
      </SettingsSection>
    </>
  )
}
