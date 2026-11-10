'use client'

import { type MouseEvent, useState } from 'react'
import { TrendChart } from '@sim/emcn/chart/charts'
import { MetricGroup } from '@sim/emcn/data-display'
import { OverflowText } from '@sim/emcn/overflow-text'
import { Tooltip } from '@sim/emcn/tooltip'
import { useQueryStates } from 'nuqs'
import { WorkspaceEmpty } from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import { formatDuration } from '@/app/(product)/_components/workspace/workspace-session/format'
import { useViewerTimeZone } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import styles from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-dashboard/run-dashboard.module.css'
import type { RunDashboardWorkflow, RunSeriesPoint } from '@/platform/lib/data/logs'
import { runListParams } from '@/platform/lib/workspace-views'
import {
  hasSegments,
  NO_SEGMENTS,
  pickedSegmentSeries,
  pickSegment,
  type SegmentPickMode,
  type SegmentSelection,
} from '@/platform/shared/run-segments'
import { formatTimestamp, LOCALE } from '@/platform/shared/time'

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

/** Legacy's gestures: Shift-click extends a range, Cmd/Ctrl-click toggles, a plain click picks one. */
function pickMode(event: MouseEvent): SegmentPickMode {
  if (event.shiftKey) return 'range'
  return event.metaKey || event.ctrlKey ? 'toggle' : 'single'
}

/**
 * Legacy's logs dashboard: runs, errors and average latency over the period, then each workflow's
 * runs by segment, most recently run first. Choosing a workflow toggles it in the Workflow filter,
 * as legacy's list does. Picking segments (click, Cmd/Ctrl-click to toggle, Shift-click for a range)
 * narrows the totals and charts to those segments, as legacy's does; a new period, workflow filter
 * or set of workflows clears the pick.
 */
export function RunDashboard({ totals, runs, errors, latency, workflows }: RunDashboardProps) {
  const timeZone = useViewerTimeZone()
  const [view, setView] = useQueryStates(runListParams, { history: 'replace', shallow: true })
  const points = (series: readonly RunSeriesPoint[]) =>
    series.map((point) => ({ label: formatTimestamp(point.at, timeZone), value: point.value }))
  const shown = view.workflow.length
    ? workflows.filter((workflow) => view.workflow.includes(workflow.id))
    : workflows
  const pickScope = [
    workflows.map((workflow) => workflow.id).join(','),
    view.period,
    view.start,
    view.end,
    view.workflow.join(','),
  ].join('|')
  const [pick, setPick] = useState<{ scope: string; selection: SegmentSelection }>({
    scope: pickScope,
    selection: NO_SEGMENTS,
  })
  const selection = pick.scope === pickScope ? pick.selection : NO_SEGMENTS
  const picked = hasSegments(selection)
    ? pickedSegmentSeries(
        selection,
        shown,
        runs.map((point) => point.at)
      )
    : null
  const shownTotals = picked?.totals ?? totals
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
          { label: 'Runs', value: shownTotals.runs.toLocaleString(LOCALE) },
          { label: 'Errors', value: shownTotals.errors.toLocaleString(LOCALE) },
          { label: 'Average latency', value: formatDuration(shownTotals.latencyMs) },
        ]}
      />
      <div className={styles.charts}>
        <TrendChart title='Runs' points={points(picked?.runs ?? runs)} />
        <TrendChart title='Errors' points={points(picked?.errors ?? errors)} />
        <TrendChart title='Latency (ms)' points={points(picked?.latency ?? latency)} />
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
                <div
                  className={styles.strip}
                  role='group'
                  aria-label={`${workflow.name} runs by period`}
                >
                  {workflow.segments.map((segment, index) => {
                    const label = `${formatTimestamp(segment.at, timeZone)}: ${segment.runs} runs, ${segment.failed} failed`
                    const pressed = selection.segments[workflow.id]?.includes(index) === true
                    return (
                      <Tooltip key={segment.at} label={label} visualOnly>
                        <button
                          type='button'
                          className={styles.segment}
                          data-state={segmentState(segment)}
                          aria-pressed={pressed}
                          aria-label={label}
                          onClick={(event) =>
                            setPick({
                              scope: pickScope,
                              selection: pickSegment(
                                selection,
                                workflow.id,
                                index,
                                pickMode(event)
                              ),
                            })
                          }
                        />
                      </Tooltip>
                    )
                  })}
                </div>
                <span className={styles.number} data-type='T060'>
                  {workflow.runs.toLocaleString(LOCALE)}
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
