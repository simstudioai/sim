'use client'

import { Button } from '@sim/emcn/button'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { notFound, useSearchParams } from 'next/navigation'
import { DetailSplit } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { RunDetails } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-details/run-details'
import { useLiveRun, useRunCommands } from '@/platform/lib/data/logs'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { toast } from '@/platform/shared/toast'

interface LiveRunProps {
  workspaceId: string
  executionId: string
  back: { href: string; label: string }
}

/**
 * One live run. A run that is still going refreshes itself and can be stopped by an editor; a run
 * whose workflow still exists can be retried from the same input or opened in the editor.
 */
export function LiveRun({ workspaceId, executionId, back }: LiveRunProps) {
  const search = useSearchParams()
  const live = useLiveRun(workspaceId, executionId)
  const commands = useRunCommands(workspaceId)
  if (live.missing) notFound()
  if (!live.run)
    return (
      <DetailSplit read={live.read} back={back} label='Run trace' railLabel='Selected step'>
        {null}
      </DetailSplit>
    )
  const { workflowId } = live
  const going = live.run.status === 'running' || live.run.status === 'waiting'
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
      run={live.run}
      back={back}
      actions={
        workflowId && (
          <>
            <Button
              variant='secondary'
              size='compact'
              render={
                <Link
                  href={platformHref(
                    workspacePath(workspaceId, `workflows/${encodeURIComponent(workflowId)}`),
                    search
                  )}
                />
              }
            >
              Open workflow
            </Button>
            {going ? (
              commands.canStop && (
                <Button
                  variant='secondary'
                  size='compact'
                  disabled={commands.stopping}
                  onClick={() => void stop(workflowId)}
                >
                  {commands.stopping ? 'Stopping…' : 'Stop run'}
                </Button>
              )
            ) : (
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
        )
      }
    />
  )
}
