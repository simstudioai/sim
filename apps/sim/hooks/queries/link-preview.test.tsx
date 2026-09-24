/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: requestMock }))

import { linkPreviewKeys, useLinkPreview } from '@/hooks/queries/link-preview'

const URL = 'https://example.com/guide'
const complete = { title: 'Guide', description: null, siteName: null }
let client: QueryClient
let container: HTMLDivElement
let root: Root

function Preview() {
  useLinkPreview(URL)
  return null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  requestMock.mockReset().mockResolvedValue({ preview: complete })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  client.clear()
})

describe('link preview freshness', () => {
  it.each([true, false])(
    'retries a one-minute-old preview only when its image is retryable: %s',
    async (retryable) => {
      client.setQueryData(
        linkPreviewKeys.detail(URL),
        { preview: { ...complete, ...(retryable ? { imageRetryable: true } : {}) } },
        { updatedAt: Date.now() - 61_000 }
      )
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Preview />
          </QueryClientProvider>
        )
      })
      expect(requestMock).toHaveBeenCalledTimes(retryable ? 1 : 0)
      if (retryable) {
        expect(requestMock).toHaveBeenCalledWith(expect.anything(), {
          query: { url: URL },
          signal: expect.any(AbortSignal),
        })
      }
    }
  )
})
