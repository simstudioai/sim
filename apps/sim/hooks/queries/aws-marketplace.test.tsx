/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import { useAwsMarketplaceBilling } from '@/hooks/queries/aws-marketplace'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

let root: Root | null = null
let billing: ReturnType<typeof useAwsMarketplaceBilling> | undefined

function Probe() {
  billing = useAwsMarketplaceBilling('org-1')
  return null
}

function render() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  })
}

async function settled(assertion: () => void) {
  await act(async () => {
    await vi.waitFor(assertion, { interval: 1, timeout: 2_000 })
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  billing = undefined
  document.body.replaceChildren()
})

describe('useAwsMarketplaceBilling', () => {
  it('stays unresolved when the license lookup fails, so plan changes stay gated', async () => {
    mockRequestJson.mockRejectedValueOnce(new Error('lookup failed'))
    render()

    await settled(() => expect(billing?.isError).toBe(true))
    expect(billing?.isResolved).toBe(false)
    expect(billing?.billedThroughMarketplace).toBe(false)
  })

  it('resolves to not Marketplace-billed when the scope holds no license', async () => {
    mockRequestJson.mockResolvedValueOnce({ licenses: [] })
    render()

    await settled(() => expect(billing?.isResolved).toBe(true))
    expect(billing?.billedThroughMarketplace).toBe(false)
    expect(billing?.isError).toBe(false)
  })
})
