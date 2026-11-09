'use client'

import { useQueryStates } from 'nuqs'
import { RunList } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-list/run-list'
import { RUN_TRIGGER_OPTIONS, useLiveRuns } from '@/platform/lib/data/logs'
import { runListParams } from '@/platform/lib/workspace-views'

/** The workspace's runs, paged by the server in the URL's period, filters and sort. */
export function LiveRuns({ workspaceId }: { workspaceId: string }) {
  const [view] = useQueryStates(runListParams)
  const live = useLiveRuns(workspaceId, view)
  return (
    <RunList
      read={live.read}
      workspace={{ id: workspaceId, live: true }}
      referenceTime={Date.now()}
      runs={live.runs}
      triggers={RUN_TRIGGER_OPTIONS}
      workflows={live.workflows}
      more={live.more}
    />
  )
}
