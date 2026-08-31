/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
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
  getWorkspaceContract,
  getWorkspacePermissionsContract,
  listPersonalApiKeysContract,
  listWorkspaceApiKeysContract,
} from '@/lib/api/contracts'
import { listWorkflowMcpServersContract } from '@/lib/api/contracts/workflow-mcp-servers'
import { apiKeysQueryOptions } from '@/hooks/queries/api-key-list'
import { useApiKeys } from '@/hooks/queries/api-keys'
import {
  useWorkflowMcpServers,
  workflowMcpServersQueryOptions,
} from '@/hooks/queries/workflow-mcp-servers'
import { useWorkspaceSettings, workspaceSettingsQueryOptions } from '@/hooks/queries/workspace'

let root: Root
let queryClient: QueryClient

function QueryProbe({ enabled }: { enabled: boolean }) {
  useApiKeys('workspace-1', 'combined', { enabled })
  useWorkspaceSettings('workspace-1', { enabled })
  useWorkflowMcpServers('workspace-1', { enabled })
  return null
}

function renderProbe(enabled: boolean) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <QueryProbe enabled={enabled} />
      </QueryClientProvider>
    )
  })
}

async function flushQueries() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve()
      await sleep(1)
    }
  })
}

describe('navigation request gating', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    root = createRoot(document.createElement('div'))
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockRequestJson.mockResolvedValue({ keys: [], data: { servers: [] } })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    vi.clearAllMocks()
  })

  it('makes no deploy-support requests while the modal has no user intent', async () => {
    renderProbe(false)
    await flushQueries()

    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('loads each deploy dependency exactly once after user intent', async () => {
    renderProbe(false)
    renderProbe(true)
    await flushQueries()

    expect(mockRequestJson).toHaveBeenCalledTimes(5)
    expect(mockRequestJson.mock.calls.map(([contract]) => contract)).toEqual(
      expect.arrayContaining([
        listWorkspaceApiKeysContract,
        listPersonalApiKeysContract,
        getWorkspaceContract,
        getWorkspacePermissionsContract,
        listWorkflowMcpServersContract,
      ])
    )
  })

  it('warms deploy dependencies without leaving hidden query observers active', async () => {
    await Promise.all([
      queryClient.prefetchQuery(apiKeysQueryOptions('workspace-1', 'combined')),
      queryClient.prefetchQuery(workspaceSettingsQueryOptions('workspace-1')),
      queryClient.prefetchQuery(workflowMcpServersQueryOptions('workspace-1')),
    ])

    expect(mockRequestJson).toHaveBeenCalledTimes(5)
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .every((query) => query.getObserversCount() === 0)
    ).toBe(true)

    renderProbe(false)
    renderProbe(true)
    await flushQueries()

    expect(mockRequestJson).toHaveBeenCalledTimes(5)
  })
})
