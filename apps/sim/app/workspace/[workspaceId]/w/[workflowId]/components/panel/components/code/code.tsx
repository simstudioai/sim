'use client'

import { useEffect } from 'react'
import { BLOCK_OPERATIONS, BLOCKS_OPERATIONS } from '@sim/realtime-protocol/constants'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import type { BlockState } from '@sim/workflow-types/workflow'
import { useQueryClient } from '@tanstack/react-query'
import {
  MonacoEditor,
  TEXT_EDITOR_OPTIONS,
  useMonacoTheme,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/monaco-editor'
import { useWorkflowScope } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { useWorkflowSource, workflowSourceKeys } from '@/hooks/queries/workflow-source'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Quiet period after the last edit before the source is re-read. */
const REFRESH_DEBOUNCE_MS = 750

const CODE_VIEW_OPTIONS = { ...TEXT_EDITOR_OPTIONS, readOnly: true, domReadOnly: true }

/** Canvas geometry: block fields and operations the printed source never shows. */
const GEOMETRY_FIELDS: ReadonlySet<string> = new Set(['position', 'height', 'layout'])
const GEOMETRY_OPERATIONS: ReadonlySet<string> = new Set([
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
])

/** Whether two block maps differ in anything but geometry; a drag replaces only moved blocks. */
function blocksChangedBeyondGeometry(
  next: Record<string, BlockState>,
  previous: Record<string, BlockState>
): boolean {
  const ids = Object.keys(next)
  if (ids.length !== Object.keys(previous).length) return true
  return ids.some((id) => {
    const block = next[id]
    const before = previous[id]
    if (block === before) return false
    if (!before) return true
    const fields = (value: BlockState) =>
      Object.entries(value).filter(([field]) => !GEOMETRY_FIELDS.has(field))
    const kept = new Map(fields(before))
    const changed = fields(block)
    return (
      changed.length !== kept.size ||
      changed.some(([field, value]) => !kept.has(field) || kept.get(field) !== value)
    )
  })
}

/**
 * Re-reads the source once the draft settles: after the graph, variables or a queued operation
 * changed something the source prints, and no local operation is still waiting to persist. Canvas
 * geometry (drags, measured heights) never prints, so it never schedules a read. A remote
 * `workflow-updated` reloads the workflow store (the socket provider holds one handler per event,
 * owned by the collaborative workflow hook), so subscribing to the store covers both remote and
 * local edits. It keeps running while the tab is hidden: invalidating a disabled query only marks
 * it stale, so the next open refetches.
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
    const unsubscribeGraph = useWorkflowStore.subscribe((state, previous) => {
      if (
        state.edges !== previous.edges ||
        state.loops !== previous.loops ||
        state.parallels !== previous.parallels ||
        (state.blocks !== previous.blocks &&
          blocksChangedBeyondGeometry(state.blocks, previous.blocks))
      ) {
        markDirty()
      }
    })
    const unsubscribeVariables = useVariablesStore.subscribe((state, previous) => {
      if (state.variables !== previous.variables) markDirty()
    })
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
      unsubscribeGraph()
      unsubscribeVariables()
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
