/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/code-editor/code-editor', () => ({
  CodeEditor: () => null,
}))

import { WorkflowScopeProvider } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { Code } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/code/code'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const WORKSPACE_ID = 'ws-1'
const WORKFLOW_ID = 'wf-1'
/** Past the Code tab's 750 ms refresh debounce. */
const SETTLE_MS = 1_200

/**
 * The Code tab against the real stores, with only the network (the source read) and the editor
 * replaced: a collaborator's field edit arrives as the collaborative hook applies it (a subblock
 * store write plus `markRemoteApplied`), with no workflow-store change and no queued operation.
 */
describe('Code tab', () => {
  let root: Root
  let container: HTMLDivElement
  let sourceReads: string[]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
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
    useVariablesStore.setState({ variables: {} })
    useWorkflowStore.setState({
      blocks: {
        group: {
          id: 'group',
          type: 'loop',
          name: 'Group',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { width: 400, height: 200 },
        },
        score: {
          id: 'score',
          type: 'function',
          name: 'Score',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [{ id: 'e1', source: 'group', target: 'score' }],
      loops: {},
      parallels: {},
    })
    useOperationQueueStore.getState().reset()
    container = document.createElement('div')
    mount()
  })

  function mount(workflowName?: string) {
    root = createRoot(container)
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <WorkflowScopeProvider workspaceId={WORKSPACE_ID} workflowId={WORKFLOW_ID}>
            <Code isActive workflowName={workflowName} />
          </WorkflowScopeProvider>
        </QueryClientProvider>
      )
    })
  }

  function queueOperation(id: string, operation: string, target: string) {
    useOperationQueueStore.getState().addToQueue({
      id,
      operation: { operation, target, payload: {} },
      workflowId: WORKFLOW_ID,
      userId: 'user-1',
    })
  }

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  function applyRemoteFieldEdit(workflowId: string, value: string) {
    act(() => {
      useWorkflowRegistry.setState({ activeWorkflowId: workflowId })
      useSubBlockStore.getState().setValue('score', 'code', value)
      useOperationQueueStore.getState().markRemoteApplied(workflowId)
      useWorkflowRegistry.setState({ activeWorkflowId: WORKFLOW_ID })
    })
  }

  function setVariable(workflowId: string, value: string) {
    act(() => {
      useVariablesStore.setState((state) => ({
        variables: {
          ...state.variables,
          [`${workflowId}-var`]: {
            id: `${workflowId}-var`,
            workflowId,
            name: 'limit',
            type: 'plain',
            value,
          },
        },
      }))
    })
  }

  async function settle() {
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS))
  }

  it("re-reads the source after a collaborator's field edit", async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    applyRemoteFieldEdit(WORKFLOW_ID, 'return 6 * 7')
    await settle()
    await vi.waitFor(() => expect(sourceReads).toHaveLength(2))
  })

  it("ignores a field edit in another workflow's values", async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    applyRemoteFieldEdit('wf-other', 'return 1')
    await settle()
    expect(sourceReads).toHaveLength(1)
  })

  it("re-reads the source after this workflow's variable changes", async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    setVariable(WORKFLOW_ID, '3')
    await settle()
    await vi.waitFor(() => expect(sourceReads).toHaveLength(2))
  })

  it('ignores a container resize, which copies the edge list without changing an edge', async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    act(() =>
      useWorkflowStore.getState().updateNodeDimensions('group', { width: 600, height: 300 })
    )
    await settle()
    expect(sourceReads).toHaveLength(1)
  })

  it('ignores a handle toggle, from the store write and from its queued operation', async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    act(() => {
      useWorkflowStore.getState().batchToggleHandles(['score'])
      useOperationQueueStore.getState().addToQueue({
        id: 'op-handles',
        operation: {
          operation: 'batch-toggle-handles',
          target: 'blocks',
          payload: { ids: ['score'] },
        },
        workflowId: WORKFLOW_ID,
        userId: 'user-1',
      })
      useOperationQueueStore.getState().confirmOperation('op-handles')
    })
    await settle()
    expect(sourceReads).toHaveLength(1)
  })

  it('ignores a single-block handle toggle, which copies the loops map', async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    act(() => useWorkflowStore.getState().setBlockHandles('score', true))
    await settle()
    expect(sourceReads).toHaveLength(1)
  })

  it('re-reads once an edit queued before the tab opened persists', async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    act(() => root.unmount())
    act(() => queueOperation('op-name', 'update-name', 'block'))
    mount()
    await vi.waitFor(() => expect(sourceReads).toHaveLength(2))
    act(() => useOperationQueueStore.getState().confirmOperation('op-name'))
    await settle()
    await vi.waitFor(() => expect(sourceReads).toHaveLength(3))
  })

  it('re-reads the source after an edge is added', async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    act(() =>
      useWorkflowStore.setState((state) => ({
        edges: [...state.edges, { id: 'e2', source: 'score', target: 'group' }],
      }))
    )
    await settle()
    await vi.waitFor(() => expect(sourceReads).toHaveLength(2))
  })

  it('ignores a variable change in another workflow', async () => {
    await vi.waitFor(() => expect(sourceReads).toHaveLength(1))
    setVariable('wf-other', '3')
    await settle()
    expect(sourceReads).toHaveLength(1)
  })

  it('copies a CLI command that gets this workflow into a shell-safe directory', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    act(() => root.unmount())
    mount(`Support "triage" & $HOME's v2`)
    const button = container.querySelector('[data-testid="workflow-code-copy-cli"]')
    if (!(button instanceof HTMLElement)) throw new Error('copy button missing')

    await act(async () => button.click())

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]).toEqual([
      expect.stringMatching(
        new RegExp(`^sim workflows source get ${WORKFLOW_ID} --dir \\./[a-z0-9-]+$`)
      ),
    ])
  })
})
