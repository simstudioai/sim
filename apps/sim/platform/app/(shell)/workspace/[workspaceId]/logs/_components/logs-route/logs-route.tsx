'use client'

import { useQueryStates } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { useRevealedCount } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { RunList } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-list/run-list'
import { type RUN_SORTS, runListParams } from '@/platform/lib/workspace-views'
import { DAY_MS } from '@/platform/shared/time'
import type { RunSummary, RunsData } from '@/platform/shared/workspace-records'

const PAGE_SIZE = 50

const PERIOD_MS = {
  all: Number.POSITIVE_INFINITY,
  '1h': DAY_MS / 24,
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
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
  // A trigger or workflow no longer among the runs, from an old link, reads as all of them.
  const trigger = triggers.some((option) => option.value === view.trigger) ? view.trigger : 'all'
  const workflow = workflows.some((option) => option.value === view.workflow)
    ? view.workflow
    : 'all'
  const since = data.referenceTime - PERIOD_MS[view.period]
  const [revealed, revealMore] = useRevealedCount(
    `logs/${data.workspace.id}/${view.period}/${view.status}/${trigger}/${workflow}/${view.sort}`,
    PAGE_SIZE
  )
  const matches = data.runs
    .filter(
      (run) =>
        run.startedAt >= since &&
        (view.status === 'all' || run.status === view.status) &&
        (trigger === 'all' || run.trigger.label === trigger) &&
        (workflow === 'all' || run.workflow.id === workflow)
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
