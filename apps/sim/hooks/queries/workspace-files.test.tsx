/**
 * @vitest-environment jsdom
 *
 * `useWorkspaceFileContent` against REAL react-query (no module mocks): the `refetchInterval`
 * option must reach the query — the editor's post-stream reconcile depends on it to poll until the
 * server content advances (see `use-editable-file-content.ts`), and both its consumers' test
 * setups replace this module, so without this file the passthrough itself would be exercised by
 * nothing but the type-checker.
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceFileContent } from '@/hooks/queries/workspace-files'

let fetchCount = 0

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fetchCount = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      fetchCount += 1
      return new Response('# content', { status: 200 })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderContentHook(options?: {
  refetchInterval?: number | false | (() => number | false)
}): { unmount: () => void } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root: Root = createRoot(container)

  function Probe() {
    useWorkspaceFileContent('ws-1', 'file-1', 'workspace/ws-1/123-abc-doc.md', false, options)
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })
  return {
    unmount: () => {
      act(() => root.unmount())
      queryClient.clear()
    },
  }
}

describe('useWorkspaceFileContent refetchInterval passthrough', () => {
  it('fetches once and does not poll by default', async () => {
    const { unmount } = renderContentHook()
    await act(async () => {
      await sleep(150)
    })
    expect(fetchCount).toBe(1)
    unmount()
  })

  it('polls when a numeric refetchInterval is passed', async () => {
    const { unmount } = renderContentHook({ refetchInterval: 30 })
    await act(async () => {
      await sleep(200)
    })
    expect(fetchCount).toBeGreaterThanOrEqual(3)
    unmount()
  })

  it('function form is re-evaluated so flipping its condition stops the polling', async () => {
    let polling = true
    const { unmount } = renderContentHook({ refetchInterval: () => (polling ? 30 : false) })
    await act(async () => {
      await sleep(200)
    })
    expect(fetchCount).toBeGreaterThanOrEqual(3)

    polling = false
    await act(async () => {
      await sleep(100)
    })
    const settled = fetchCount
    await act(async () => {
      await sleep(150)
    })
    expect(fetchCount).toBe(settled)
    unmount()
  })
})
