'use client'

import { useEffect, useState } from 'react'
import { BLOCK_OPERATIONS, BLOCKS_OPERATIONS } from '@sim/realtime-protocol/constants'
import { useQueryClient } from '@tanstack/react-query'
import type { editor } from 'monaco-editor'
import {
  MonacoEditor,
  TEXT_EDITOR_OPTIONS,
  useMonacoTheme,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/monaco-editor'
import { useWorkflowScope } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import {
  registerSourceLanguage,
  SOURCE_LANGUAGE_ID,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/code/source-language'
import { minimalTextEdit } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/code/text-edit'
import { subscribeToDraftChanges } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-draft-workflow-state'
import { useWorkflowSourceText, workflowSourceKeys } from '@/hooks/queries/workflow-source'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import type { QueuedOperation } from '@/stores/operation-queue/types'

/** Quiet period after the last edit before the source is re-read. */
const REFRESH_DEBOUNCE_MS = 750

const CODE_VIEW_OPTIONS = { ...TEXT_EDITOR_OPTIONS, readOnly: true, domReadOnly: true }

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

/**
 * Brings the editor's model to `text` with the one edit that differs, so a refresh keeps the
 * scroll position, cursor and tokens of every unchanged line. Replacing the value instead (what
 * the `value` prop does for a read-only editor) would jump to line 1 and re-tokenize the file.
 */
function useSyncedModelText(view: editor.IStandaloneCodeEditor | null, text: string) {
  useEffect(() => {
    const model = view?.getModel()
    if (!model) return
    const edit = minimalTextEdit(model.getValue(), text)
    if (!edit) return
    const start = model.getPositionAt(edit.start)
    const end = model.getPositionAt(edit.end)
    model.applyEdits([
      {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        text: edit.text,
      },
    ])
  }, [view, text])
}

interface CodeProps {
  /** Fetches only while the tab is showing. */
  isActive: boolean
}

/** The workflow draft as read-only TypeScript source. */
export function Code({ isActive }: CodeProps) {
  const { workflowId } = useWorkflowScope()
  const monacoTheme = useMonacoTheme()
  const [view, setView] = useState<editor.IStandaloneCodeEditor | null>(null)
  const {
    data: text,
    error,
    isPending,
  } = useWorkflowSourceText(workflowId ?? undefined, {
    enabled: isActive,
  })
  useRefreshWhenDraftSettles(workflowId)
  useSyncedModelText(view, text ?? '')

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
      defaultValue={text}
      language={SOURCE_LANGUAGE_ID}
      theme={monacoTheme}
      options={CODE_VIEW_OPTIONS}
      beforeMount={registerSourceLanguage}
      onMount={setView}
      className='h-full'
    />
  )
}
