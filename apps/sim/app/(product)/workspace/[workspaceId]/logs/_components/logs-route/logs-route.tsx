'use client'

import { useQueryStates } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { useRevealedCount } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { RunList } from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-list/run-list'
import { type RUN_PERIODS, type RUN_SORTS, runListParams } from '@/platform/lib/workspace-views'
import { DAY_MS, MINUTE_MS } from '@/platform/shared/time'
import type { RunSummary, RunsData } from '@/platform/shared/workspace-records'

const PAGE_SIZE = 50

const HOUR_MS = DAY_MS / 24

const PERIOD_MS: Record<Exclude<(typeof RUN_PERIODS)[number], 'custom'>, number> = {
  all: Number.POSITIVE_INFINITY,
  '30m': HOUR_MS / 2,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '12h': 12 * HOUR_MS,
  '24h': DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '14d': 14 * DAY_MS,
  '30d': 30 * DAY_MS,
}

function compareRuns(sort: (typeof RUN_SORTS)[number]) {
  return (left: RunSummary, right: RunSummary) => {
    switch (sort) {
      case 'oldest':
        return left.startedAt - right.startedAt
      case 'duration':
        return (right.durationMs ?? -1) - (left.durationMs ?? -1)
      case 'cu':
        return (right.cu ?? -1) - (left.cu ?? -1)
      default:
        return right.startedAt - left.startedAt
    }
  }
}

/** The example runs, filtered, sorted and revealed in the browser as the server pages live runs. */
function ExampleRuns({ data }: { data: RunsData }) {
  const [view] = useQueryStates(runListParams)
  const workflows = [...new Map(data.runs.map((run) => [run.workflow.id, run.workflow])).values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((workflow) => ({ value: workflow.id, label: workflow.name }))
  const triggers = [...new Set(data.runs.map((run) => run.trigger.label))]
    .sort()
    .map((trigger) => ({ value: trigger, label: trigger }))
  // A trigger or workflow no longer among the runs, from an old link, filters nothing.
  const trigger = view.trigger.filter((value) => triggers.some((option) => option.value === value))
  const workflow = view.workflow.filter((value) =>
    workflows.some((option) => option.value === value)
  )
  // A custom range reads its local bounds as legacy's calendar writes them.
  const [since, until] =
    view.period === 'custom'
      ? [
          view.start ? Date.parse(view.start) : Number.NEGATIVE_INFINITY,
          view.end ? Date.parse(view.end) + MINUTE_MS : Number.POSITIVE_INFINITY,
        ]
      : [data.referenceTime - PERIOD_MS[view.period], Number.POSITIVE_INFINITY]
  const [revealed, revealMore] = useRevealedCount(
    `logs/${data.workspace.id}/${view.period}/${view.start}/${view.end}/${view.status}/${trigger}/${workflow}/${view.sort}`,
    PAGE_SIZE
  )
  const matches = data.runs
    .filter(
      (run) =>
        run.startedAt >= since &&
        run.startedAt < until &&
        (view.status === 'all' || run.status === view.status) &&
        (trigger.length === 0 || trigger.includes(run.trigger.label)) &&
        (workflow.length === 0 || workflow.includes(run.workflow.id))
    )
    .sort(compareRuns(view.sort))
  return (
    <RunList
      workspace={data.workspace}
      referenceTime={data.referenceTime}
      runs={matches.slice(0, revealed)}
      triggers={triggers}
      workflows={workflows}
      more={{ hasMore: matches.length > revealed, onLoadMore: revealMore }}
    />
  )
}

/** The example runs. Example time is fixed, so the list holds; live data refreshes itself. */
export function LogsRoute({ data }: { data: RunsData }) {
  return (
    <NuqsAdapter>
      <ExampleRuns data={data} />
    </NuqsAdapter>
  )
}
