'use client'

import { useEffect } from 'react'
import { BLOCK_OPERATIONS, BLOCKS_OPERATIONS } from '@sim/realtime-protocol/constants'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { useQueryClient } from '@tanstack/react-query'
import {
  MonacoEditor,
  TEXT_EDITOR_OPTIONS,
  useMonacoTheme,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/monaco-editor'
import { useWorkflowScope } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { subscribeToDraftChanges } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-draft-workflow-state'
import { useWorkflowSource, workflowSourceKeys } from '@/hooks/queries/workflow-source'
import { useOperationQueueStore } from '@/stores/operation-queue/store'

/** Quiet period after the last edit before the source is re-read. */
const REFRESH_DEBOUNCE_MS = 750

const CODE_VIEW_OPTIONS = { ...TEXT_EDITOR_OPTIONS, readOnly: true, domReadOnly: true }

/** Canvas geometry operations, which the printed source never shows. */
const GEOMETRY_OPERATIONS: ReadonlySet<string> = new Set([
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
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
    /** Something the source prints changed since the last read was scheduled. */
    let dirty = false
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
        (operation) =>
          !queued.has(operation.id) &&
          operation.workflowId === workflowId &&
          !GEOMETRY_OPERATIONS.has(operation.operation.operation)
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

interface CodeProps {
  /** Fetches only while the tab is showing. */
  isActive: boolean
}

/** The workflow draft as read-only TypeScript source. */
export function Code({ isActive }: CodeProps) {
  const { workflowId } = useWorkflowScope()
  const monacoTheme = useMonacoTheme()
  const { data, error, isPending } = useWorkflowSource(workflowId ?? undefined, {
    enabled: isActive,
  })
  useRefreshWhenDraftSettles(workflowId)

  // A failed refresh replaces the code rather than leaving a stale copy that no longer matches the draft.
  if (error) {
    return (
      <div
        className='px-3 py-2 text-[var(--text-tertiary)] text-small'
        data-testid='workflow-code-error'
      >
        Couldn't load code: {error.message}
      </div>
    )
  }
  if (isPending) {
    return <div className='px-3 py-2 text-[var(--text-tertiary)] text-small'>Loading code…</div>
  }

  return (
    <MonacoEditor
      value={data.files[SOURCE_ENTRY_FILE] ?? ''}
      language='typescript'
      theme={monacoTheme}
      options={CODE_VIEW_OPTIONS}
      className='h-full'
    />
  )
}
