'use client'

import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'
import {
  Avatar,
  BarChart,
  Button,
  DataTable,
  EmptyState,
  FailureNotice,
  LoadingRows,
  MetricGroup,
  OverflowText,
  Pagination,
  Select,
  TableLabel,
  TrendChart,
} from '@/platform/design-system/components'
import { HeadingRow } from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import {
  useActivityBreakdown,
  useActivitySummary,
  useUsageView,
} from '@/platform/embedded/lib/data/usage'
import { ACTIVITY_DIMENSIONS, ACTIVITY_SORTS, formatDurationMs } from '@/platform/shared/usage'

interface ActivityOverviewProps {
  organizationId: string
  window: OrganizationUsageWindowKey
  workspaceId?: string
}

function SummaryView({ summary }: { summary: ReturnType<typeof useActivitySummary> }) {
  return (
    <section className={styles.block} aria-label='Activity'>
      <h2 data-type='T042'>Activity</h2>
      {summary.failed ? (
        <FailureNotice message='Couldn’t load activity.' onRetry={summary.retry} />
      ) : summary.pending ? (
        <span className={styles.chartPlaceholder} role='status' aria-label='Loading activity' />
      ) : (
        <>
          <MetricGroup metrics={summary.metrics} />
          <div className={styles.cards}>
            <div className={styles.block}>
              <BarChart
                title='Workflow runs'
                bars={summary.outcomeBars}
                series={summary.outcomeSeries}
              />
              <p className={styles.quiet} data-type='T060'>
                Other includes cancelled, paused, and unfinished runs.
              </p>
            </div>
            <TrendChart title='Chat runs' points={summary.chatPoints} />
          </div>
        </>
      )}
    </section>
  )
}

export function ActivityOverview({ organizationId, window, workspaceId }: ActivityOverviewProps) {
  return <SummaryView summary={useActivitySummary(organizationId, window, workspaceId)} />
}

const WORKFLOW_RUNS = { key: 'workflowRuns', label: 'Workflow runs', kind: 'number' } as const
const CHAT_RUNS = { key: 'chatRuns', label: 'Chat runs', kind: 'number' } as const
const FAILED = { key: 'failed', label: 'Failed', kind: 'number' } as const
const FAILURE_RATE = { key: 'failureRate', label: 'Failure rate', kind: 'text' } as const
const DURATION = { key: 'duration', label: 'Avg. duration', kind: 'text' } as const

const COLUMNS_BY_DIMENSION = {
  workspace: [
    { key: 'label', label: 'Workspace', kind: 'text' },
    WORKFLOW_RUNS,
    CHAT_RUNS,
    FAILURE_RATE,
    DURATION,
  ],
  workflow: [
    { key: 'label', label: 'Workflow', kind: 'text' },
    WORKFLOW_RUNS,
    FAILED,
    FAILURE_RATE,
    DURATION,
  ],
  member: [{ key: 'label', label: 'Member', kind: 'text' }, CHAT_RUNS],
  trigger: [
    { key: 'label', label: 'Trigger', kind: 'text' },
    WORKFLOW_RUNS,
    FAILED,
    FAILURE_RATE,
    DURATION,
  ],
} as const

export function ActivityPanel({ organizationId }: { organizationId: string }) {
  const view = useUsageView()
  const { window, workspace, activityDimension, activitySort, activityPage, setState } = view
  const workspaceId = workspace ?? undefined
  const sort = activityDimension === 'member' ? 'runs' : activitySort
  const summary = useActivitySummary(organizationId, window, workspaceId)
  const breakdown = useActivityBreakdown(
    organizationId,
    window,
    activityDimension,
    sort,
    activityPage,
    workspaceId
  )
  const toAllWorkspaces = () =>
    void setState({ workspace: null, activityDimension: 'workspace', activityPage: 0 })
  if (workspace && summary.unavailable)
    return (
      <EmptyState
        title='Workspace unavailable.'
        action={<Button onClick={toAllWorkspaces}>All workspaces</Button>}
      />
    )
  const member = activityDimension === 'member'
  return (
    <>
      {workspace && (
        <HeadingRow>
          <Button variant='quiet' icon='I093' onClick={toAllWorkspaces}>
            All workspaces
          </Button>
          <span data-type='T067'>{summary.workspaceName ?? 'Workspace activity'}</span>
        </HeadingRow>
      )}
      <SummaryView summary={summary} />
      <section className={styles.block} aria-label='Breakdown'>
        <h2 data-type='T042'>Breakdown</h2>
        <HeadingRow>
          <Select
            label='Group activity by'
            variant='quiet'
            options={ACTIVITY_DIMENSIONS}
            value={activityDimension}
            onValueChange={(value) =>
              void setState({
                activityDimension: value as typeof activityDimension,
                activityPage: 0,
              })
            }
          />
          {!member && (
            <Select
              label='Sort activity by'
              variant='quiet'
              options={ACTIVITY_SORTS}
              value={sort}
              onValueChange={(value) =>
                void setState({ activitySort: value as typeof activitySort, activityPage: 0 })
              }
            />
          )}
        </HeadingRow>
        {breakdown.failed ? (
          <FailureNotice message='Couldn’t load the breakdown.' onRetry={breakdown.retry} />
        ) : !breakdown.rows ? (
          <LoadingRows label='Loading breakdown' />
        ) : breakdown.rows.length === 0 ? (
          <EmptyState title='No activity in this period.' />
        ) : (
          <DataTable
            title='Activity breakdown'
            titleHidden
            columns={COLUMNS_BY_DIMENSION[activityDimension]}
            rows={breakdown.rows.map((row) => ({
              id: row.id,
              values: {
                label: row.label,
                workflowRuns: row.workflowRuns,
                chatRuns: row.chatRuns,
                failed: row.failed,
                failureRate: row.failureRateLabel,
                duration: formatDurationMs(row.averageDurationMs),
              },
              cells: {
                label: (
                  <TableLabel
                    leading={
                      member ? (
                        <Avatar size='inline' name={row.label} src={row.image ?? undefined} />
                      ) : undefined
                    }
                  >
                    <OverflowText
                      text={
                        activityDimension === 'workflow' && row.workspaceName
                          ? `${row.label} · ${row.workspaceName}`
                          : row.label
                      }
                    />
                  </TableLabel>
                ),
              },
              onOpen:
                activityDimension === 'workspace' && row.workspaceId
                  ? () =>
                      void setState(
                        {
                          workspace: row.workspaceId,
                          activityDimension: 'workflow',
                          activityPage: 0,
                        },
                        { history: 'push' }
                      )
                  : undefined,
            }))}
          />
        )}
        {(activityPage > 0 || breakdown.hasMore) && (
          <Pagination
            label='Activity pages'
            page={activityPage + 1}
            hasNext={breakdown.hasMore && activityPage < breakdown.maxPage}
            disabled={breakdown.loading}
            onPageChange={(page) => void setState({ activityPage: page - 1 })}
          />
        )}
      </section>
    </>
  )
}
