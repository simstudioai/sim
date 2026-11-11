'use client'

import type { ReactNode } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { BarChart, TrendChart } from '@sim/emcn/chart/charts'
import { DataTable, MetricGroup, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { Pagination } from '@sim/emcn/pagination'
import { FailureNotice } from '@sim/emcn/status'
import {
  DetailHeader,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { UsageBlock } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-block'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'
import {
  type OrganizationUsageWindowKey,
  useActivityBreakdown,
  useActivitySummary,
  useUsageView,
} from '@/platform/lib/data/usage'
import { ACTIVITY_DIMENSIONS, ACTIVITY_SORTS, formatDurationMs } from '@/platform/shared/usage'

interface ActivityOverviewProps {
  organizationId: string
  window: OrganizationUsageWindowKey
  workspaceId?: string
}

function SummaryView({ summary }: { summary: ReturnType<typeof useActivitySummary> }) {
  return (
    <UsageBlock title='Activity'>
      {summary.failed ? (
        <FailureNotice message='Couldn’t load activity.' onRetry={summary.retry} />
      ) : summary.pending ? null : (
        <>
          <MetricGroup metrics={summary.metrics} />
          <div className={styles.cards}>
            <div className={styles.captioned}>
              <BarChart
                title='Workflow runs'
                bars={summary.outcomeBars}
                series={summary.outcomeSeries}
              />
              <p className={styles.quiet} data-type='T060'>
                Other includes cancelled, paused, and unfinished runs
              </p>
            </div>
            <TrendChart title='Chat runs' points={summary.chatPoints} />
          </div>
        </>
      )}
    </UsageBlock>
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

interface ActivityPanelProps {
  organizationId: string
  /** The period menu a drilled-into workspace shows under its own header. */
  period?: ReactNode
}

export function ActivityPanel({ organizationId, period }: ActivityPanelProps) {
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
  const header = workspace && (
    <>
      <DetailHeader
        backLabel='Activity'
        title={summary.workspaceName ?? 'Workspace activity'}
        onBack={() =>
          void setState({ workspace: null, activityDimension: 'workspace', activityPage: 0 })
        }
      />
      {period && <SectionToolbar>{period}</SectionToolbar>}
    </>
  )
  if (workspace && summary.unavailable)
    return (
      <>
        {header}
        <EmptyState title='Workspace unavailable' />
      </>
    )
  const member = activityDimension === 'member'
  return (
    <>
      {header}
      <SummaryView summary={summary} />
      <UsageBlock title='Breakdown'>
        <SectionToolbar>
          <ChoiceMenu
            label='Group activity by'
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
            <ChoiceMenu
              label='Sort activity by'
              options={ACTIVITY_SORTS}
              value={sort}
              onValueChange={(value) =>
                void setState({ activitySort: value as typeof activitySort, activityPage: 0 })
              }
            />
          )}
        </SectionToolbar>
        {breakdown.failed ? (
          <FailureNotice message='Couldn’t load the breakdown.' onRetry={breakdown.retry} />
        ) : !breakdown.rows ? null : breakdown.rows.length === 0 ? (
          <EmptyState title='No activity in this period' />
        ) : (
          <DataTable
            title='Activity breakdown'
            titleHidden
            columns={COLUMNS_BY_DIMENSION[activityDimension]}
            rows={breakdown.rows.map((row) => {
              const label =
                activityDimension === 'workflow' && row.workspaceName
                  ? `${row.label} · ${row.workspaceName}`
                  : row.label
              return {
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
                      <OverflowText text={label}>{label}</OverflowText>
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
              }
            })}
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
      </UsageBlock>
    </>
  )
}
