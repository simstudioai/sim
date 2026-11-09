'use client'

import { Button } from '@sim/emcn/button'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { notFound, useSearchParams } from 'next/navigation'
import { toast } from '@/lib/toast/sink'
import { DetailSplit } from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { RunDetails } from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-details/run-details'
import { useLiveRun, useRunCommands } from '@/platform/lib/data/logs'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withRunListView } from '@/platform/lib/workspace-views'

interface LiveRunProps {
  workspaceId: string
  executionId: string
  back: { href: string; label: string }
}

/**
 * One live run. A run that is still going refreshes itself and can be stopped by an editor; a
 * failed run can be retried from the same input or handed to a new chat; a workflow run opens its
 * workflow and the frozen snapshot it executed.
 */
export function LiveRun({ workspaceId, executionId, back }: LiveRunProps) {
  const search = useSearchParams()
  const live = useLiveRun(workspaceId, executionId)
  const commands = useRunCommands(workspaceId)
  if (live.missing) notFound()
  if (!live.run || !live.commands)
    return (
      <DetailSplit read={live.read} back={back} label='Run trace' railLabel='Selected step'>
        {null}
      </DetailSplit>
    )
  const { run } = live
  const { workflowId, openWorkflowId, retryable, stoppable } = live.commands
  const stopping = live.commands.stopping || commands.stopping(executionId)
  const stop = async (id: string) => {
    try {
      await commands.stop(id, executionId)
      toast.success('Run stopped')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to stop run'))
    }
  }
  const retry = async (id: string) => {
    try {
      await commands.retry(id, executionId)
      toast.success('Retry started')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to retry run'))
    }
  }
  return (
    <RunDetails
      run={run}
      back={back}
      read={live.read}
      actions={
        <>
          {openWorkflowId && (
            <Button
              variant='secondary'
              size='compact'
              render={
                <Link
                  href={platformHref(
                    workspacePath(workspaceId, `workflows/${encodeURIComponent(openWorkflowId)}`),
                    search
                  )}
                />
              }
            >
              Open workflow
            </Button>
          )}
          {live.hasSnapshot && (
            <Button
              variant='secondary'
              size='compact'
              render={
                <Link
                  href={withRunListView(
                    platformHref(
                      workspacePath(
                        workspaceId,
                        `workflows/runs/${encodeURIComponent(executionId)}`
                      ),
                      search
                    ),
                    Object.fromEntries(search.entries())
                  )}
                />
              }
            >
              View snapshot
            </Button>
          )}
          {run.status === 'failed' && live.commands.snapshot && commands.canTroubleshoot && (
            <Button
              variant='secondary'
              size='compact'
              onClick={() => commands.troubleshoot(executionId, run.workflow.name)}
            >
              Troubleshoot in Chat
            </Button>
          )}
          {stoppable && workflowId && commands.canStop && (
            <Button
              variant='secondary'
              size='compact'
              disabled={stopping}
              onClick={() => void stop(workflowId)}
            >
              {stopping ? 'Stopping…' : 'Stop run'}
            </Button>
          )}
          {retryable && workflowId && (
            <Button
              variant='secondary'
              size='compact'
              disabled={commands.retrying}
              onClick={() => void retry(workflowId)}
            >
              {commands.retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </>
      }
    />
  )
}
