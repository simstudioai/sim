/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { useStartSlackSearchOAuth } from '@/hooks/queries/slack-search'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

describe('useStartSlackSearchOAuth', () => {
  let root: Root
  let client: QueryClient
  let result: ReturnType<typeof useStartSlackSearchOAuth>

  function Probe() {
    result = useStartSlackSearchOAuth()
    return null
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mockRequestJson.mockReset()
    client = new QueryClient()
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
  })

  it('cancels an in-flight browser OAuth start when its signal aborts', async () => {
    mockRequestJson.mockImplementation(
      (_contract: unknown, input: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          input.signal?.addEventListener('abort', () => reject(input.signal?.reason))
        )
    )
    const controller = new AbortController()
    let outcome: 'pending' | 'rejected' = 'pending'
    await act(async () => {
      void result
        .mutateAsync({
          organizationId: 'org-1',
          name: 'Sim Search',
          description: 'Search Slack',
          mode: 'shared',
          signal: controller.signal,
        })
        .catch(() => {
          outcome = 'rejected'
        })
    })
    await act(async () => controller.abort())
    expect(outcome).toBe('rejected')
  })
})
