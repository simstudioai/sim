'use client'

import { TrendChart } from '@sim/emcn/chart/charts'
import { MetricGroup } from '@sim/emcn/data-display'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useQueryStates } from 'nuqs'
import { WorkspaceEmpty } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import { formatDuration } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/format'
import { useViewerTimeZone } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-dashboard/run-dashboard.module.css'
import type { RunDashboardWorkflow, RunSeriesPoint } from '@/platform/lib/data/logs'
import { runListParams } from '@/platform/lib/workspace-views'
import { formatTimestamp } from '@/platform/shared/time'

interface RunDashboardProps {
  totals: { runs: number; errors: number; latencyMs: number }
  runs: readonly RunSeriesPoint[]
  errors: readonly RunSeriesPoint[]
  latency: readonly RunSeriesPoint[]
  workflows: readonly RunDashboardWorkflow[]
}

/** A segment's state on a workflow's strip: no runs, all succeeded, some failed, or all failed. */
function segmentState(segment: RunDashboardWorkflow['segments'][number]) {
  if (segment.runs === 0) return 'idle'
  if (segment.failed === 0) return 'success'
  return segment.failed === segment.runs ? 'failed' : 'mixed'
}

/**
 * Legacy's logs dashboard: runs, errors and average latency over the period, then each workflow's
 * runs by segment, most recently run first. Choosing a workflow toggles it in the Workflow filter,
 * as legacy's list does.
 */
export function RunDashboard({ totals, runs, errors, latency, workflows }: RunDashboardProps) {
  const timeZone = useViewerTimeZone()
  const [view, setView] = useQueryStates(runListParams, { history: 'replace', shallow: true })
  const points = (series: readonly RunSeriesPoint[]) =>
    series.map((point) => ({ label: formatTimestamp(point.at, timeZone), value: point.value }))
  const shown = view.workflow.length
    ? workflows.filter((workflow) => view.workflow.includes(workflow.id))
    : workflows
  if (!workflows.length)
    return (
      <WorkspaceEmpty
        title='No runs in this period'
        description='Try another period or clear the filters.'
      />
    )
  return (
    <div className={styles.dashboard}>
      <MetricGroup
        metrics={[
          { label: 'Runs', value: totals.runs.toLocaleString() },
          { label: 'Errors', value: totals.errors.toLocaleString() },
          { label: 'Average latency', value: formatDuration(totals.latencyMs) },
        ]}
      />
      <div className={styles.charts}>
        <TrendChart title='Runs' points={points(runs)} />
        <TrendChart title='Errors' points={points(errors)} />
        <TrendChart title='Latency (ms)' points={points(latency)} />
      </div>
      <section className={styles.section} aria-label='Workflows'>
        <h2 data-type='T042'>Workflows</h2>
        <ul className={styles.workflows}>
          {shown.map((workflow) => {
            const selected = view.workflow.includes(workflow.id)
            const rate = `${Math.round(workflow.successRate)}%`
            return (
              <li
                key={workflow.id}
                className={styles.workflow}
                data-selected={selected || undefined}
              >
                <button
                  type='button'
                  className={styles.open}
                  aria-pressed={selected}
                  aria-label={`${workflow.name}, ${workflow.runs} runs, ${rate} succeeded`}
                  onClick={() =>
                    void setView({
                      workflow: selected
                        ? view.workflow.filter((id) => id !== workflow.id)
                        : [...view.workflow, workflow.id],
                    })
                  }
                >
                  <span className={styles.name} data-type='T060'>
                    <OverflowText text={workflow.name}>{workflow.name}</OverflowText>
                  </span>
                </button>
                <svg
                  className={styles.strip}
                  role='img'
                  aria-label={`${workflow.name} runs by period`}
                  preserveAspectRatio='none'
                  viewBox={`0 0 ${workflow.segments.length} 1`}
                >
                  {workflow.segments.map((segment, index) => (
                    <rect
                      key={segment.at}
                      className={styles.segment}
                      data-state={segmentState(segment)}
                      x={index}
                      width={0.8}
                      height={1}
                    >
                      <title>
                        {`${formatTimestamp(segment.at, timeZone)}: ${segment.runs} runs, ${segment.failed} failed`}
                      </title>
                    </rect>
                  ))}
                </svg>
                <span className={styles.number} data-type='T060'>
                  {workflow.runs.toLocaleString()}
                </span>
                <span className={styles.number} data-type='T060'>
                  {rate}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
