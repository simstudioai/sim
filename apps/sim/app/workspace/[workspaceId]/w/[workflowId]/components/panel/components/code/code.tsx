'use client'

import { useEffect } from 'react'
import { Badge, Button, Tooltip, useCopyToClipboard } from '@sim/emcn'
import { BookOpen, Check, TerminalWindow } from '@sim/emcn/icons'
import { BLOCK_OPERATIONS, BLOCKS_OPERATIONS } from '@sim/realtime-protocol/constants'
import { slugify } from '@sim/utils/string'
import { useQueryClient } from '@tanstack/react-query'
import { CodeEditor } from '@/components/code-editor/code-editor'
import { DOCS_URL } from '@/lib/help-links'
import { useWorkflowScope } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { subscribeToDraftChanges } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-draft-workflow-state'
import { useWorkflowSourceText, workflowSourceKeys } from '@/hooks/queries/workflow-source'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import type { QueuedOperation } from '@/stores/operation-queue/types'

/** Quiet period after the last edit before the source is re-read. */
const REFRESH_DEBOUNCE_MS = 750

const WORKFLOW_CODE_DOCS_URL = `${DOCS_URL}/workflows/code`

/** Canvas geometry operations (moves and handle orientation), which the printed source never shows. */
const GEOMETRY_OPERATIONS: ReadonlySet<string> = new Set([
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
  BLOCK_OPERATIONS.TOGGLE_HANDLES,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
])

/**
 * Re-reads the source once the draft settles: after the graph, a field value, variables or a
 * queued operation changed something the source prints, and no local operation is still waiting
 * to persist. Canvas geometry (drags, measured heights) never prints, so it never schedules a read.
 * Remote edits arrive as store writes, not operations: a `workflow-updated` reloads the workflow
 * store, and a collaborator's field edit writes only the subblock store, so each store is watched.
 * It keeps running while the tab is hidden: invalidating a disabled query only marks it stale, so
 * the next open refetches.
 */
function useRefreshWhenDraftSettles(workflowId: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workflowId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const isPrintable = (operation: QueuedOperation) =>
      operation.workflowId === workflowId && !GEOMETRY_OPERATIONS.has(operation.operation.operation)
    /**
     * Something the source prints changed since the last read was scheduled. An edit still queued
     * when the tab opens counts: the first read can land before it persists.
     */
    let dirty = useOperationQueueStore.getState().operations.some(isPrintable)
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!dirty || useOperationQueueStore.getState().hasPendingOperations(workflowId)) return
        dirty = false
        queryClient.invalidateQueries({ queryKey: workflowSourceKeys.detail(workflowId) })
      }, REFRESH_DEBOUNCE_MS)
    }
    const markDirty = () => {
      dirty = true
      schedule()
    }
    const unsubscribeDraft = subscribeToDraftChanges(workflowId, markDirty)
    const unsubscribeQueue = useOperationQueueStore.subscribe((state, previous) => {
      if (state.operations === previous.operations) return
      const queued = new Set(previous.operations.map((operation) => operation.id))
      const printable = state.operations.some(
        (operation) => !queued.has(operation.id) && isPrintable(operation)
      )
      if (printable) markDirty()
      else if (dirty) schedule()
    })
    return () => {
      clearTimeout(timer)
      // Leaving inside the debounce would keep a fresh-looking pre-edit copy in the cache.
      if (dirty) queryClient.invalidateQueries({ queryKey: workflowSourceKeys.detail(workflowId) })
      unsubscribeDraft()
      unsubscribeQueue()
    }
  }, [workflowId, queryClient])
}

interface CodeHeaderProps {
  workflowId: string | null
  workflowName?: string
}

/**
 * The tab's title row: the preview label, a copy of the CLI command that writes this workflow into
 * a local directory (named after the workflow, so it is shell-safe), and the docs.
 */
function CodeHeader({ workflowId, workflowName }: CodeHeaderProps) {
  const { copied, copy } = useCopyToClipboard()
  const dir = slugify(workflowName ?? '') || 'workflow'

  return (
    <div className='mx-[-1px] flex shrink-0 items-center justify-between border border-[var(--border)] bg-[var(--surface-4)] px-3 py-1.5'>
      <div className='flex min-w-0 items-center gap-2'>
        <h2 className='text-[var(--text-primary)] text-sm'>workflow.ts</h2>
        <Badge variant='gray-secondary' size='sm'>
          Preview
        </Badge>
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        {workflowId && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                className='p-0'
                aria-label='Copy CLI command'
                data-testid='workflow-code-copy-cli'
                onClick={() => copy(`sim workflows source get ${workflowId} --dir ./${dir}`)}
              >
                {copied ? (
                  <Check className='size-[14px] text-[var(--text-icon)]' />
                ) : (
                  <TerminalWindow className='size-[14px] text-[var(--text-icon)]' />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <p>{copied ? 'Copied' : 'Copy CLI command'}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='p-0'
              aria-label='Open docs'
              onClick={() => window.open(WORKFLOW_CODE_DOCS_URL, '_blank', 'noopener,noreferrer')}
            >
              <BookOpen className='size-[14px] text-[var(--text-icon)]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <p>Docs</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  )
}

interface CodeProps {
  /** Fetches only while the tab is showing. */
  isActive: boolean
  /** Names the directory in the copied CLI command. */
  workflowName?: string
}

/** The workflow draft as read-only TypeScript source. */
export function Code({ isActive, workflowName }: CodeProps) {
  const { workflowId } = useWorkflowScope()
  const {
    data: text,
    error,
    isPending,
  } = useWorkflowSourceText(workflowId ?? undefined, {
    enabled: isActive,
  })
  useRefreshWhenDraftSettles(workflowId)

  return (
    <div className='flex h-full flex-col'>
      <CodeHeader workflowId={workflowId} workflowName={workflowName} />
      {/* A failed refresh replaces the code rather than leaving a stale copy that no longer matches the draft. */}
      {error ? (
        <div
          className='px-3 py-2 text-[var(--text-tertiary)] text-small'
          data-testid='workflow-code-error'
        >
          Couldn't load code: {error.message}
        </div>
      ) : isPending ? (
        <div className='px-3 py-2 text-[var(--text-tertiary)] text-small'>Loading code…</div>
      ) : (
        <div className='min-h-0 flex-1'>
          <CodeEditor value={text} fileName='workflow.ts' readOnly />
        </div>
      )}
    </div>
  )
}
