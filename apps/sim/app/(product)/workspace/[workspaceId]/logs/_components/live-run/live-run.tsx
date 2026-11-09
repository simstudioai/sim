'use client'

import { useEffect, useEffectEvent } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { workspacePath } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import { DetailSplit } from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { RunDetails } from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-details/run-details'
import { useLiveRun, useRunCommands, useRunNeighbors } from '@/platform/lib/data/logs'
import { platformHref } from '@/platform/lib/navigation'
import { runListParams, withRunListView } from '@/platform/lib/workspace-views'

/**
 * Whether the focused element moves its own selection with the arrow keys, as a field, a menu or the
 * trace's step rows do, so ArrowUp and ArrowDown stay with it.
 */
function ownsArrowKeys(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.closest(
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="slider"], [data-trace-target]'
    ) !== null
  )
}

/**
 * Legacy's run-to-run keys: with a run open, ArrowUp and ArrowDown (without Cmd or Ctrl) open the
 * previous or next run in the list's order, replacing the URL, and stepping past the last run read
 * so far reads the next page first. Previous and Next buttons beside the run do the same.
 */
function useRunSteps(workspaceId: string, executionId: string) {
  const router = useRouter()
  const search = useSearchParams()
  const [view] = useQueryStates(runListParams)
  const neighbors = useRunNeighbors(workspaceId, executionId, view)
  const open = (id: string) =>
    router.replace(
      withRunListView(
        platformHref(workspacePath(workspaceId, `logs/${encodeURIComponent(id)}`), search),
        Object.fromEntries(search.entries())
      ),
      { scroll: false }
    )
  const canPrevious = neighbors.previous !== undefined
  const canNext = neighbors.next !== undefined || (neighbors.hasMore && !neighbors.loadingMore)
  const previous = () => {
    if (neighbors.previous) open(neighbors.previous)
  }
  const next = async () => {
    const after =
      neighbors.next ??
      (neighbors.hasMore && !neighbors.loadingMore && (await neighbors.readNext()))
    if (after) open(after)
  }
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey) return
    if (ownsArrowKeys(event.target)) return
    if (event.key === 'ArrowUp' && canPrevious) {
      event.preventDefault()
      previous()
    } else if (event.key === 'ArrowDown' && canNext) {
      event.preventDefault()
      void next()
    }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  return { canPrevious, canNext, previous, next }
}

interface LiveRunProps {
  workspaceId: string
  executionId: string
  back: { href: string; label: string }
}

/**
 * One live run. A run that is still going refreshes itself and can be stopped by an editor; a
 * failed run can be retried from the same input or handed to a new chat; a workflow run opens its
 * workflow and the frozen snapshot it executed. ArrowUp and ArrowDown step to the list's previous
 * and next run.
 */
export function LiveRun({ workspaceId, executionId, back }: LiveRunProps) {
  const search = useSearchParams()
  const live = useLiveRun(workspaceId, executionId)
  const commands = useRunCommands(workspaceId)
  const steps = useRunSteps(workspaceId, executionId)
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
      key={executionId}
      run={run}
      back={back}
      read={live.read}
      actions={
        <>
          <IconButton
            label='Previous run'
            icon='I023'
            size='compact'
            tooltip
            disabled={!steps.canPrevious}
            onClick={steps.previous}
          />
          <IconButton
            label='Next run'
            icon='I102'
            size='compact'
            tooltip
            disabled={!steps.canNext}
            onClick={() => void steps.next()}
          />
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
