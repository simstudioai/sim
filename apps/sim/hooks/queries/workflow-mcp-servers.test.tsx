/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import {
  deleteWorkflowMcpServerContract,
  listWorkflowMcpToolsContract,
} from '@/lib/api/contracts/workflow-mcp-servers'
import {
  useDeleteWorkflowMcpServer,
  useWorkflowMcpTools,
  workflowMcpServerKeys,
} from '@/hooks/queries/workflow-mcp-servers'

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

async function flushQueries() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve()
      await sleep(1)
    }
  })
}

describe('workflow MCP server queries', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    vi.clearAllMocks()
  })

  it('does not carry protected tool data between server keys', async () => {
    mockRequestJson.mockImplementation((contract, input) => {
      if (contract !== listWorkflowMcpToolsContract) throw new Error('Unexpected request')
      const serverId = input.params.id
      if (serverId === 'server-a') {
        return Promise.resolve({ data: { tools: [{ id: 'tool-a', name: 'Tool A' }] } })
      }
      return new Promise(() => undefined)
    })

    function Probe({ serverId }: { serverId: string }) {
      const query = useWorkflowMcpTools('workspace-1', serverId)
      return <span>{query.data?.[0]?.name ?? 'loading'}</span>
    }

    act(() => root.render(<Wrapper>{<Probe serverId='server-a' />}</Wrapper>))
    await flushQueries()
    expect(container.textContent).toBe('Tool A')

    act(() => root.render(<Wrapper>{<Probe serverId='server-b' />}</Wrapper>))
    expect(container.textContent).toBe('loading')
  })

  it('removes a deleted server detail subtree and invalidates its list', async () => {
    mockRequestJson.mockImplementation((contract) => {
      if (contract === deleteWorkflowMcpServerContract) return Promise.resolve({ success: true })
      throw new Error('Unexpected request')
    })
    queryClient.setQueryData(workflowMcpServerKeys.servers('workspace-1'), [{ id: 'server-1' }])
    queryClient.setQueryData(workflowMcpServerKeys.server('workspace-1', 'server-1'), {
      server: { id: 'server-1' },
      tools: [],
    })
    queryClient.setQueryData(workflowMcpServerKeys.tools('workspace-1', 'server-1'), [])
    let mutation: ReturnType<typeof useDeleteWorkflowMcpServer> | undefined

    function Probe() {
      mutation = useDeleteWorkflowMcpServer()
      return null
    }

    act(() => root.render(<Wrapper>{<Probe />}</Wrapper>))
    await act(async () => {
      await mutation?.mutateAsync({ workspaceId: 'workspace-1', serverId: 'server-1' })
    })

    expect(
      queryClient.getQueriesData({
        queryKey: workflowMcpServerKeys.server('workspace-1', 'server-1'),
      })
    ).toHaveLength(0)
    expect(
      queryClient.getQueryState(workflowMcpServerKeys.servers('workspace-1'))?.isInvalidated
    ).toBe(true)
  })

  it('preserves a server detail subtree when deletion fails', async () => {
    mockRequestJson.mockImplementation((contract) => {
      if (contract === deleteWorkflowMcpServerContract) {
        return Promise.reject(new Error('Delete failed'))
      }
      throw new Error('Unexpected request')
    })
    const serverKey = workflowMcpServerKeys.server('workspace-1', 'server-1')
    const toolsKey = workflowMcpServerKeys.tools('workspace-1', 'server-1')
    queryClient.setQueryData(serverKey, { server: { id: 'server-1' }, tools: [] })
    queryClient.setQueryData(toolsKey, [{ id: 'tool-1' }])
    let mutation: ReturnType<typeof useDeleteWorkflowMcpServer> | undefined

    function Probe() {
      mutation = useDeleteWorkflowMcpServer()
      return null
    }

    act(() => root.render(<Wrapper>{<Probe />}</Wrapper>))
    await act(async () => {
      await mutation
        ?.mutateAsync({ workspaceId: 'workspace-1', serverId: 'server-1' })
        .catch(() => {})
    })

    expect(queryClient.getQueryData(serverKey)).toEqual({
      server: { id: 'server-1' },
      tools: [],
    })
    expect(queryClient.getQueryData(toolsKey)).toEqual([{ id: 'tool-1' }])
  })
})
