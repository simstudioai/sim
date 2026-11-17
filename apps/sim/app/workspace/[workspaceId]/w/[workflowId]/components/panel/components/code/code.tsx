'use client'

import { useEffect } from 'react'
import { BLOCK_OPERATIONS, BLOCKS_OPERATIONS } from '@sim/realtime-protocol/constants'
import { BLOCK_LAYOUT_DATA_FIELDS, BLOCK_LAYOUT_FIELDS } from '@sim/workflow-code/layout'
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
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Quiet period after the last edit before the source is re-read. */
const REFRESH_DEBOUNCE_MS = 750

const CODE_VIEW_OPTIONS = { ...TEXT_EDITOR_OPTIONS, readOnly: true, domReadOnly: true }

/**
 * Canvas geometry: block fields and operations the printed source never shows. `data` is
 * compared field by field instead, since a resize writes its width and height.
 */
const GEOMETRY_FIELDS: ReadonlySet<string> = new Set([...BLOCK_LAYOUT_FIELDS, 'data'])
const GEOMETRY_DATA_FIELDS: ReadonlySet<string> = new Set(BLOCK_LAYOUT_DATA_FIELDS)
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
    return (
      differsBeyond(block, before, GEOMETRY_FIELDS) ||
      differsBeyond(block.data ?? {}, before.data ?? {}, GEOMETRY_DATA_FIELDS)
    )
  })
}

/** Whether two records differ by identity in any field outside `ignored`. */
function differsBeyond(next: object, previous: object, ignored: ReadonlySet<string>): boolean {
  const fields = (value: object) => Object.entries(value).filter(([field]) => !ignored.has(field))
  const kept = new Map(fields(previous))
  const changed = fields(next)
  return (
    changed.length !== kept.size ||
    changed.some(([field, value]) => !kept.has(field) || kept.get(field) !== value)
  )
}

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
    const unsubscribeValues = useSubBlockStore.subscribe((state, previous) => {
      if (state.workflowValues[workflowId] !== previous.workflowValues[workflowId]) markDirty()
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
      // Leaving inside the debounce would keep a fresh-looking pre-edit copy in the cache.
      if (dirty) queryClient.invalidateQueries({ queryKey: workflowSourceKeys.detail(workflowId) })
      unsubscribeGraph()
      unsubscribeValues()
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
