'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { RunsData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { RunList } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-list/run-list'

interface LogsRouteProps {
  data: RunsData
}

/** The example runs. Example time is fixed, so the list holds; live data refreshes itself. */
export function LogsRoute({ data }: LogsRouteProps) {
  return (
    <NuqsAdapter>
      <RunList data={data} />
    </NuqsAdapter>
  )
}
