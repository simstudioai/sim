/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer/monaco-editor', () => ({
  MonacoEditor: () => null,
  TEXT_EDITOR_OPTIONS: {},
  useMonacoTheme: () => 'vs',
}))

import { WorkflowScopeProvider } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { Code } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/code/code'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const WORKSPACE_ID = 'ws-1'
const WORKFLOW_ID = 'wf-1'
/** Past the Code tab's 750 ms refresh debounce. */
const SETTLE_MS = 1_200

/**
 * The Code tab against the real stores, with only the network (the source read) and Monaco
 * replaced: a collaborator's field edit arrives as the collaborative hook applies it (a subblock
 * store write plus `markRemoteApplied`), with no workflow-store change and no queued operation.
 */
describe('Code tab refresh', () => {
  let root: Root
  let sourceReads: string[]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    sourceReads = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === `/api/workflows/${WORKFLOW_ID}/source`) sourceReads.push(url.pathname)
        return new Response(
          JSON.stringify({
            data: {
              workflowId: WORKFLOW_ID,
              workspaceId: WORKSPACE_ID,
              files: { 'workflow.ts': `// read ${sourceReads.length}` },
              lock: { version: 1, blocks: {}, variables: {} },
              base: {
                workflowId: WORKFLOW_ID,
                workspaceId: WORKSPACE_ID,
                fingerprint: `f${sourceReads.length}`,
                catalogHash: 'c',
              },
              canonicalHash: 'h',
              sdkMajor: 1,
              blockTypes: [],
              diagnostics: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )
    useWorkflowRegistry.setState({ activeWorkflowId: WORKFLOW_ID })
    useSubBlockStore.setState({ workflowValues: {} })
    const container = document.createElement('div')
    root = createRoot(container)
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <WorkflowScopeProvider workspaceId={WORKSPACE_ID} workflowId={WORKFLOW_ID}>
            <Code isActive />
          </WorkflowScopeProvider>
        </QueryClientProvider>
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  function applyRemoteFieldEdit(workflowId: string, value: string) {
    act(() => {
      useWorkflowRegistry.setState({ activeWorkflowId: workflowId })
      useSubBlockStore.getState().setValue('score', 'code', value)
      useOperationQueueStore.getState().markRemoteApplied(workflowId)
      useWorkflowRegistry.setState({ activeWorkflowId: WORKFLOW_ID })
    })
  }

  async function settle() {
    await act(() => new Promise((done) => setTimeout(done, SETTLE_MS)))
  }

  it("re-reads the source after a collaborator's field edit", async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    applyRemoteFieldEdit(WORKFLOW_ID, 'return 6 * 7')
    await settle()
    expect(sourceReads).toHaveLength(2)
  })

  it("ignores a field edit in another workflow's values", async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    applyRemoteFieldEdit('wf-other', 'return 1')
    await settle()
    expect(sourceReads).toHaveLength(1)
  })
})
