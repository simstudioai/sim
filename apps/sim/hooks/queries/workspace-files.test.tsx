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
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import {
  useCreateWorkspaceFile,
  useWorkspaceFileContent,
  useWorkspaceFiles,
  type WorkspaceFileContentResult,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

let fetchCount = 0

beforeEach(() => {
  vi.clearAllMocks()
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
  refetchOnWindowFocus?: boolean
}): { queryClient: QueryClient; unmount: () => void } {
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
    queryClient,
    unmount: () => {
      act(() => root.unmount())
      queryClient.clear()
    },
  }
}

function renderCreateHook(): {
  getMutation: () => ReturnType<typeof useCreateWorkspaceFile>
  queryClient: QueryClient
  unmount: () => void
} {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let mutation: ReturnType<typeof useCreateWorkspaceFile> | undefined

  function Probe() {
    mutation = useCreateWorkspaceFile()
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
    getMutation: () => {
      if (!mutation) throw new Error('Create mutation did not render')
      return mutation
    },
    queryClient,
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
 * A content update rewrites the file under a NEW storage key and deletes the old object, so the key
 * held by an open tab goes dead — every few seconds while a collaborative document is being edited,
 * since the relay persists it server-side. These pin the two halves of the answer: don't create the
 * staleness where a server-side owner holds durability, and recover from it everywhere else.
 */
describe('useWorkspaceFileContent stale storage key', () => {
  async function focusWindow() {
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await sleep(50)
    })
  }

  afterEach(() => {
    focusManager.setFocused(undefined)
  })

  it('re-reads on focus by default, so an out-of-band edit reaches an open tab', async () => {
    const { unmount } = renderContentHook()
    await act(async () => {
      await sleep(50)
    })
    expect(fetchCount).toBe(1)

    await focusWindow()

    expect(fetchCount).toBe(2)
    unmount()
  })

  it('does not re-read on focus when the collaborative relay owns durability', async () => {
    const { unmount } = renderContentHook({ refetchOnWindowFocus: false })
    await act(async () => {
      await sleep(50)
    })
    expect(fetchCount).toBe(1)

    await focusWindow()

    expect(fetchCount).toBe(1)
    unmount()
  })

  it('re-resolves the file record when the key it read has been superseded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount += 1
        return new Response('{"error":"FileNotFoundError"}', { status: 404 })
      })
    )
    const { queryClient, unmount } = renderContentHook()
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries')

    await act(async () => {
      await sleep(50)
    })

    expect(fetchCount).toBe(1)
    expect(refetchQueries).toHaveBeenCalledWith(
      { queryKey: workspaceFilesKeys.workspaceLists('ws-1') },
      { cancelRefetch: true }
    )
    // The RECORD is re-resolved, never this query — re-driving the read against the same dead key
    // is what would spin.
    expect(refetchQueries).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('leaves the record alone when the read fails for any other reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount += 1
        return new Response('nope', { status: 500 })
      })
    )
    const { queryClient, unmount } = renderContentHook()
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries')

    await act(async () => {
      await sleep(50)
    })

    expect(fetchCount).toBe(1)
    expect(refetchQueries).not.toHaveBeenCalled()
    unmount()
  })
})

describe('useCreateWorkspaceFile', () => {
  it('uses the create contract and reconciles workspace file caches', async () => {
    const response = { success: true, file: { id: 'wf-created' } }
    mockRequestJson.mockResolvedValue(response)
    const { getMutation, queryClient, unmount } = renderCreateHook()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    let result: unknown

    await act(async () => {
      result = await getMutation().mutateAsync({
        workspaceId: 'ws-1',
        name: 'notes.md',
        contentType: 'text/markdown',
      })
    })

    expect(result).toBe(response)
    expect(mockRequestJson).toHaveBeenCalledWith(createWorkspaceFileContract, {
      params: { id: 'ws-1' },
      body: { name: 'notes.md', contentType: 'text/markdown' },
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceFilesKeys.workspaceLists('ws-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceFilesKeys.storageInfo(),
    })
    unmount()
  })
})

/**
 * The rotation costs one request; it must not cost a lie. Between the 404 and the record re-resolving,
 * the surface is mid-recovery — reporting a failure there paints "Failed to load file content" over a
 * document that lands a few hundred milliseconds later, gone before the reader can act on it.
 */
describe('useWorkspaceFileContent while a superseded key is being re-resolved', () => {
  /** Mounts the content read alongside the record query the recovery re-resolves, so the second list
   *  fetch can be held open and the recovery window observed from the outside. */
  function renderDuringRecovery(): {
    getResult: () => WorkspaceFileContentResult
    resolveRecord: () => void
    unmount: () => void
  } {
    let releaseRecord: () => void = () => {}
    let call = 0
    mockRequestJson.mockImplementation(async () => {
      // First call is the initial record load; the one the 404 triggers is held open.
      if (++call > 1) await new Promise<void>((resolve) => (releaseRecord = resolve))
      return { success: true, files: [] }
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const root: Root = createRoot(document.createElement('div'))
    let result: WorkspaceFileContentResult | undefined

    function Probe() {
      useWorkspaceFiles('ws-1')
      result = useWorkspaceFileContent('ws-1', 'file-1', 'workspace/ws-1/123-abc-doc.md', false)
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
      getResult: () => {
        if (!result) throw new Error('Content hook did not render')
        return result
      },
      resolveRecord: () => releaseRecord(),
      unmount: () => {
        act(() => root.unmount())
        queryClient.clear()
      },
    }
  }

  function serve404() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount += 1
        return new Response('{"error":"FileNotFoundError"}', { status: 404 })
      })
    )
  }

  it('reports still-loading, not failed, while the record is being re-resolved', async () => {
    serve404()
    const { getResult, resolveRecord, unmount } = renderDuringRecovery()
    await act(async () => {
      await sleep(50)
    })

    expect(getResult().error).toBeNull()
    expect(getResult().isLoading).toBe(true)

    resolveRecord()
    unmount()
  })

  it('surfaces the failure once the record comes back unchanged — the object is really gone', async () => {
    serve404()
    const { getResult, resolveRecord, unmount } = renderDuringRecovery()
    await act(async () => {
      await sleep(50)
    })

    await act(async () => {
      resolveRecord()
      await sleep(50)
    })

    expect(getResult().error).not.toBeNull()
    expect(getResult().isLoading).toBe(false)
    unmount()
  })

  it('never masks a failure that is not a superseded key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount += 1
        return new Response('nope', { status: 500 })
      })
    )
    const { getResult, resolveRecord, unmount } = renderDuringRecovery()
    await act(async () => {
      await sleep(50)
    })

    expect(getResult().error).not.toBeNull()
    resolveRecord()
    unmount()
  })
})
