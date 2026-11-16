'use client'

import { useEffect } from 'react'
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

const WORKFLOW_FILE = 'workflow.ts'

/** Quiet period after the last edit before the source is re-read. */
const REFRESH_DEBOUNCE_MS = 750

const CODE_VIEW_OPTIONS = { ...TEXT_EDITOR_OPTIONS, readOnly: true, domReadOnly: true }

/**
 * Re-reads the source once the draft settles: after the graph or variables change and no local
 * operation is still waiting to persist. A remote `workflow-updated` reloads the workflow store
 * (the socket provider holds one handler per event, owned by the collaborative workflow hook), so
 * subscribing to the store covers both remote and local edits. It keeps running while the tab is
 * hidden: invalidating a disabled query only marks it stale, so the next open refetches.
 */
function useRefreshWhenDraftSettles(workflowId: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workflowId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (useOperationQueueStore.getState().hasPendingOperations(workflowId)) return
        queryClient.invalidateQueries({ queryKey: workflowSourceKeys.detail(workflowId) })
      }, REFRESH_DEBOUNCE_MS)
    }
    const unsubscribeGraph = useWorkflowStore.subscribe((state, previous) => {
      if (
        state.blocks !== previous.blocks ||
        state.edges !== previous.edges ||
        state.loops !== previous.loops ||
        state.parallels !== previous.parallels
      ) {
        schedule()
      }
    })
    const unsubscribeVariables = useVariablesStore.subscribe((state, previous) => {
      if (state.variables !== previous.variables) schedule()
    })
    const unsubscribeQueue = useOperationQueueStore.subscribe((state, previous) => {
      if (state.operations !== previous.operations) schedule()
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
      value={data.files[WORKFLOW_FILE] ?? ''}
      language='typescript'
      theme={monacoTheme}
      options={CODE_VIEW_OPTIONS}
      className='h-full'
    />
  )
}
