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
import {
  useRefreshWorkspaceFiles,
  useRenameWorkspaceFile,
  useWorkspaceFileContent,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

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

/**
 * The optimistic patch in `useRenameWorkspaceFile.onMutate`: a retype must move BOTH the name and
 * the stored type in the cache, because the viewer picks its editor from `type` and would otherwise
 * keep rendering the old one until the invalidation lands.
 */
describe('useRenameWorkspaceFile optimistic cache patch', () => {
  const WS = 'ws-1'
  const FILE_ID = 'file-1'

  const existingFile = {
    id: FILE_ID,
    workspaceId: WS,
    name: 'untitled.md',
    key: `workspace/${WS}/123-abc-untitled.md`,
    path: '/api/files/serve/mock-key?context=workspace',
    size: 0,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    folderId: null,
    uploadedAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
  }

  function renderRenameHook(): {
    rename: () => ReturnType<typeof useRenameWorkspaceFile>
    queryClient: QueryClient
    unmount: () => void
  } {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workspaceFilesKeys.list(WS, 'active'), [existingFile])

    const container = document.createElement('div')
    const root: Root = createRoot(container)
    let result: ReturnType<typeof useRenameWorkspaceFile> | null = null

    function Probe() {
      result = useRenameWorkspaceFile()
      return null
    }

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    })

    return {
      rename: () => {
        if (!result) throw new Error('hook did not render')
        return result
      },
      queryClient,
      unmount: () => {
        act(() => root.unmount())
        queryClient.clear()
      },
    }
  }

  function cachedFile(queryClient: QueryClient) {
    const list = queryClient.getQueryData<(typeof existingFile)[]>(
      workspaceFilesKeys.list(WS, 'active')
    )
    return list?.[0]
  }

  /**
   * Leaves the request in flight, so the assertion sees the optimistic write rather than whatever
   * `onSettled`'s invalidation refetches over it.
   */
  function stubPendingFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    )
  }

  it('patches name and type together on a retype', async () => {
    stubPendingFetch()
    const { rename, queryClient, unmount } = renderRenameHook()

    await act(async () => {
      rename().mutate({
        workspaceId: WS,
        fileId: FILE_ID,
        name: 'untitled.json',
        contentType: 'application/json',
      })
      await sleep(20)
    })

    expect(cachedFile(queryClient)).toMatchObject({
      name: 'untitled.json',
      type: 'application/json',
    })
    unmount()
  })

  it('leaves type untouched on a plain rename', async () => {
    stubPendingFetch()
    const { rename, queryClient, unmount } = renderRenameHook()

    await act(async () => {
      rename().mutate({ workspaceId: WS, fileId: FILE_ID, name: 'notes.md' })
      await sleep(20)
    })

    expect(cachedFile(queryClient)).toMatchObject({ name: 'notes.md', type: 'text/markdown' })
    unmount()
  })

  it('rolls the type back when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    )
    const { rename, queryClient, unmount } = renderRenameHook()

    await act(async () => {
      rename().mutate({
        workspaceId: WS,
        fileId: FILE_ID,
        name: 'untitled.json',
        contentType: 'application/json',
      })
      await sleep(50)
    })

    expect(cachedFile(queryClient)).toMatchObject({
      name: 'untitled.md',
      type: 'text/markdown',
    })
    unmount()
  })
})

/**
 * A collaborative flush mints a new storage key and deletes the previous blob, so a retype has to
 * wait for the refreshed list before it swaps editors - the newly mounted viewer reads `key` off
 * that record, and the pre-flush one 404s.
 */
describe('useRefreshWorkspaceFiles', () => {
  const WS = 'ws-1'

  function renderRefresh(): {
    refresh: () => (workspaceId: string) => Promise<void>
    queryClient: QueryClient
    unmount: () => void
  } {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    let result: ((workspaceId: string) => Promise<void>) | null = null

    function Probe() {
      result = useRefreshWorkspaceFiles()
      return null
    }

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    })

    return {
      refresh: () => {
        if (!result) throw new Error('hook did not render')
        return result
      },
      queryClient,
      unmount: () => {
        act(() => root.unmount())
        queryClient.clear()
      },
    }
  }

  it('resolves only after the refetched list has landed', async () => {
    const keys = ['workspace/ws-1/old-key', 'workspace/ws-1/new-key']
    let call = 0
    const queryFn = vi.fn(async () => {
      const key = keys[Math.min(call, keys.length - 1)]
      call += 1
      await sleep(10)
      return [{ id: 'file-1', key }]
    })

    const { refresh, queryClient, unmount } = renderRefresh()
    const queryKey = workspaceFilesKeys.list(WS, 'active')
    await act(async () => {
      await queryClient.fetchQuery({ queryKey, queryFn })
    })
    expect(queryClient.getQueryData<{ key: string }[]>(queryKey)?.[0].key).toBe(
      'workspace/ws-1/old-key'
    )

    await act(async () => {
      await refresh()(WS)
    })

    // The awaited call must have already replaced the dead key, not merely marked it stale.
    expect(queryClient.getQueryData<{ key: string }[]>(queryKey)?.[0].key).toBe(
      'workspace/ws-1/new-key'
    )
    expect(queryFn).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('refetches a cached list that no component is observing', async () => {
    // `refetchType: 'all'` is load-bearing: the retype awaits this before mounting the next viewer,
    // and the default `active` would resolve instantly against an unobserved list.
    const queryFn = vi.fn(async () => [{ id: 'file-1', key: 'k' }])
    const { refresh, queryClient, unmount } = renderRefresh()

    await act(async () => {
      await queryClient.fetchQuery({ queryKey: workspaceFilesKeys.list(WS, 'active'), queryFn })
      await refresh()(WS)
    })

    expect(queryFn).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('leaves another workspace list alone', async () => {
    const otherQueryFn = vi.fn(async () => [{ id: 'file-2', key: 'k2' }])
    const { refresh, queryClient, unmount } = renderRefresh()

    await act(async () => {
      await queryClient.fetchQuery({
        queryKey: workspaceFilesKeys.list('ws-2', 'active'),
        queryFn: otherQueryFn,
      })
      await refresh()(WS)
    })

    expect(otherQueryFn).toHaveBeenCalledTimes(1)
    unmount()
  })
})
