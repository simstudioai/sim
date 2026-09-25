/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('next/navigation', () => nextNavigationMock)

import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const mockRefresh = nextNavigationMockFns.router.refresh

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

it.each([true, false])(
  'clears document content and refreshes server pages after integration update success=%s',
  async (success) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mockRequestJson.mockReset()
    mockRefresh.mockReset()
    const response = Promise.withResolvers<{ data: { connectorType: string; approved: boolean } }>()
    mockRequestJson.mockReturnValue(response.promise)
    const client = new QueryClient()
    const root = createRoot(document.createElement('div'))
    const key = knowledgeKeys.document('kb-direct', 'document-direct')
    client.setQueryData(key, { content: 'previously authorized content' })
    let mutation: ReturnType<typeof useUpdateSearchIntegration>
    function Probe() {
      mutation = useUpdateSearchIntegration()
      return null
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      )
      let pending: Promise<unknown>
      await act(async () => {
        pending = mutation.mutateAsync({
          organizationId: 'org-1',
          connectorType: 'github',
          approved: false,
        })
      })
      await act(async () =>
        root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>)
      )
      await act(async () => {
        if (success) {
          response.resolve({ data: { connectorType: 'github', approved: false } })
          await pending
        } else {
          const rejection = expect(pending).rejects.toThrow('Try again')
          response.reject(new Error('Try again'))
          await rejection
        }
      })
      expect(mockRefresh).toHaveBeenCalledTimes(success ? 1 : 0)
      if (success) expect(client.getQueryData(key)).toBeUndefined()
      else expect(client.getQueryData(key)).toEqual({ content: 'previously authorized content' })
    } finally {
      await act(async () => root.unmount())
      client.clear()
    }
  }
)
