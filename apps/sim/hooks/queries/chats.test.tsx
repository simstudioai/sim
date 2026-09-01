/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, mockInvalidateDeploymentQueries } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockInvalidateDeploymentQueries: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/hooks/queries/deployments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/queries/deployments')>()),
  invalidateDeploymentQueries: mockInvalidateDeploymentQueries,
}))

import { useCreateChat, useUpdateChat } from '@/hooks/queries/chats'

/** Trees rendered by a test, torn down in afterEach so observers do not leak across tests. */
const mountedRoots: Root[] = []

function renderHookWithClient<T>(useHook: () => T): { getResult: () => T } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  mountedRoots.push(root)
  let result: T | undefined

  function Probe() {
    result = useHook()
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await sleep(1)
    }
  })
}

const FORM_DATA = {
  identifier: 'my-chat',
  title: 'My chat',
  description: '',
  authType: 'public' as const,
  password: '',
  emails: [],
  welcomeMessage: 'hi',
  selectedOutputBlocks: [],
  includeThinking: false,
  includeToolCalls: false,
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  mockRequestJson.mockResolvedValue({ chatUrl: 'https://sim.ai/chat/my-chat', chatId: 'chat-1' })
  mockInvalidateDeploymentQueries.mockResolvedValue(undefined)
})

describe('chat mutations invalidate the deployment boundary', () => {
  /**
   * PATCH /api/chat/manage/[id] calls performFullDeploy when the workflow has
   * drifted, so a chat edit can mint a new deployment version. Invalidating only
   * chatStatus/chatDetail left the deployment panel showing the previous version.
   */
  it('useUpdateChat invalidates every deployment query for the workflow', async () => {
    const { getResult } = renderHookWithClient(() => useUpdateChat())

    await act(async () => {
      await getResult().mutateAsync({
        chatId: 'chat-1',
        workflowId: 'wf-1',
        formData: FORM_DATA,
      })
    })
    await flush()

    expect(mockInvalidateDeploymentQueries).toHaveBeenCalledWith(expect.anything(), 'wf-1')
  })

  it('useCreateChat invalidates every deployment query for the workflow', async () => {
    const { getResult } = renderHookWithClient(() => useCreateChat())

    await act(async () => {
      await getResult().mutateAsync({ workflowId: 'wf-1', formData: FORM_DATA })
    })
    await flush()

    expect(mockInvalidateDeploymentQueries).toHaveBeenCalledWith(expect.anything(), 'wf-1')
  })

  it('normalizes a legacy empty output path to the deployed chat fallback', async () => {
    const { getResult } = renderHookWithClient(() => useUpdateChat())

    await act(async () => {
      await getResult().mutateAsync({
        chatId: 'chat-1',
        workflowId: 'wf-1',
        formData: { ...FORM_DATA, selectedOutputBlocks: ['agent-block_'] },
      })
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({
          outputConfigs: [{ blockId: 'agent-block', path: 'content' }],
        }),
      })
    )
  })
})
