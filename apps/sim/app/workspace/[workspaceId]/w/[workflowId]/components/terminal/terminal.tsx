'use client'

import { memo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Terminal as LiveTerminal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/live-terminal'
import { LogsOverviewPrototype } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/prototype/logs-overview-prototype'
import { LogsPanelPrototype } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/prototype/logs-panel-prototype'
import { RunHistoryPrototype } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/prototype/run-history-prototype'

function TerminalVariant() {
  const searchParams = useSearchParams()
  const prototypeVariant =
    process.env.NODE_ENV === 'development' ? searchParams.get('logsPrototype') : null

  if (prototypeVariant === '1') return <LogsPanelPrototype />
  if (prototypeVariant === '2') return <LogsOverviewPrototype />
  if (prototypeVariant === '3') return <RunHistoryPrototype />
  if (prototypeVariant === '4') return null

  return <LiveTerminal />
}

export const Terminal = memo(function Terminal() {
  return (
    <Suspense fallback={<LiveTerminal />}>
      <TerminalVariant />
    </Suspense>
  )
})
