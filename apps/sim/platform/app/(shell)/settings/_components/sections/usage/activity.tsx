'use client'

import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import {
  Avatar,
  BarChart,
  Button,
  DataTable,
  EmptyState,
  InlineNotice,
  MetricGroup,
  OverflowText,
  Pagination,
  Select,
  TrendChart,
} from '@/platform/design-system/components'
import {
  ACTIVITY_DIMENSIONS,
  ACTIVITY_SORTS,
  formatActivityFailureRate,
  formatDurationMs,
  type OrganizationUsageWindowKey,
  useActivityBreakdown,
  useActivitySummary,
  useUsageView,
} from '@/platform/lib/data/usage'

interface ActivityOverviewProps {
  organizationId: string
  window: OrganizationUsageWindowKey
  workspaceId?: string
}

function SummaryView({ summary }: { summary: ReturnType<typeof useActivitySummary> }) {
  return (
    <section className={styles.block} aria-label='Activity'>
      <h2 data-type='T093'>Activity</h2>
      {summary.failed ? (
        <InlineNotice
          intent='danger'
          message='Couldn’t load activity.'
          action={
            <Button variant='quiet' size='compact' onClick={summary.retry}>
              Retry
            </Button>
          }
        />
      ) : summary.pending ? (
        <span className={styles.chartPlaceholder} role='status' aria-label='Loading activity' />
      ) : (
        <>
          <MetricGroup metrics={summary.metrics} />
          <div className={styles.charts}>
            <BarChart
              title='Workflow runs'
              bars={summary.outcomeBars}
              series={summary.outcomeSeries}
            />
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

const DIMENSION_LABELS = {
  workspace: 'Workspace',
  workflow: 'Workflow',
  member: 'Member',
  trigger: 'Trigger',
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
  const workspaceDimension = activityDimension === 'workspace'
  const columns = [
    { key: 'label', label: DIMENSION_LABELS[activityDimension], kind: 'text' as const },
    ...(member ? [] : [{ key: 'workflowRuns', label: 'Workflow runs', kind: 'number' as const }]),
    ...(member || workspaceDimension
      ? [{ key: 'chatRuns', label: 'Chat runs', kind: 'number' as const }]
      : []),
    ...(member || workspaceDimension
      ? []
      : [{ key: 'failed', label: 'Failed', kind: 'number' as const }]),
    ...(member
      ? []
      : [
          { key: 'failureRate', label: 'Failure rate', kind: 'text' as const },
          { key: 'duration', label: 'Avg. duration', kind: 'text' as const },
        ]),
  ]
  return (
    <>
      {workspace && (
        <div className={styles.toolbar}>
          <Button variant='quiet' icon='I093' onClick={toAllWorkspaces}>
            All workspaces
          </Button>
          <span data-type='T067'>{summary.workspaceName ?? 'Workspace activity'}</span>
        </div>
      )}
      <SummaryView summary={summary} />
      <section className={styles.block} aria-label='Breakdown'>
        <h2 data-type='T093'>Breakdown</h2>
        <div className={styles.toolbar}>
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
        </div>
        {breakdown.failed ? (
          <InlineNotice
            intent='danger'
            message='Couldn’t load the breakdown.'
            action={
              <Button variant='quiet' size='compact' onClick={breakdown.retry}>
                Retry
              </Button>
            }
          />
        ) : !breakdown.rows ? (
          <span className={styles.listPlaceholder} role='status' aria-label='Loading breakdown' />
        ) : breakdown.rows.length === 0 ? (
          <EmptyState title='No activity in this period.' />
        ) : (
          <DataTable
            title='Activity breakdown'
            titleHidden
            columns={columns}
            rows={breakdown.rows.map((row) => ({
              id: row.id,
              values: {
                label: row.label,
                workflowRuns: row.workflowRuns,
                chatRuns: row.chatRuns,
                failed: row.failed,
                failureRate: formatActivityFailureRate(row.failureRate),
                duration: formatDurationMs(row.averageDurationMs),
              },
              cells: {
                label: (
                  <span className={styles.nameCell}>
                    {member && (
                      <Avatar size='inline' name={row.label} src={row.image ?? undefined} />
                    )}
                    <OverflowText
                      text={
                        activityDimension === 'workflow' && row.workspaceName
                          ? `${row.label} · ${row.workspaceName}`
                          : row.label
                      }
                    />
                  </span>
                ),
              },
              onOpen:
                workspaceDimension && row.workspaceId
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
