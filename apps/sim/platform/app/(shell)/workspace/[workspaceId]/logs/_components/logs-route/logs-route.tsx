'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { RunsData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useIncomingRuns } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { RunList } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-list/run-list'

interface LogsRouteProps {
  data: RunsData
}

/** Example runs; the new-runs action brings the waiting example runs in for this session. */
export function LogsRoute({ data }: LogsRouteProps) {
  const incoming = useIncomingRuns()
  return (
    <NuqsAdapter>
      <RunList
        data={
          incoming.shown ? { ...data, runs: [...data.incoming, ...data.runs], incoming: [] } : data
        }
        actions={{ showIncoming: incoming.show }}
      />
    </NuqsAdapter>
  )
}
