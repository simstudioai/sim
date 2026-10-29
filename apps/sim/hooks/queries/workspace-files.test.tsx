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
import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { sleep } from '@sim/utils/helpers'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import {
  listWorkspaceFilesContract,
  readWorkspaceFileContract,
  renameWorkspaceFileContract,
  searchWorkspaceFilesContract,
  updateWorkspaceFileContentContract,
} from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  type WorkspaceFileListParams,
  workspaceFileListParams,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'
import { invalidateWorkspaceFileBrowsers } from '@/hooks/queries/workspace-file-folders'
import {
  useReloadWorkspaceFileContent,
  useRenameWorkspaceFile,
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
  useWorkspaceFileList,
  useWorkspaceFileRecord,
  type WorkspaceFileContentResult,
} from '@/hooks/queries/workspace-files'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

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

describe('useUpdateWorkspaceFileContent version precondition', () => {
  it('forwards the supplied content version and disables mutation retries', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } })
    const container = document.createElement('div')
    const root = createRoot(container)
    let mutation: ReturnType<typeof useUpdateWorkspaceFileContent> | undefined
    function Probe() {
      mutation = useUpdateWorkspaceFileContent()
      return null
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    )
    const expectedUpdatedAt = '2026-09-03T20:00:00.000Z'
    mockRequestJson.mockRejectedValueOnce(new Error('conflict'))
    await act(async () => {
      await expect(
        mutation?.mutateAsync({
          workspaceId: 'ws-1',
          fileId: 'file-1',
          content: 'draft',
          expectedUpdatedAt,
        })
      ).rejects.toThrow('conflict')
    })
    expect(mockRequestJson).toHaveBeenCalledExactlyOnceWith(updateWorkspaceFileContentContract, {
      params: { id: 'ws-1', fileId: 'file-1' },
      body: { content: 'draft', expectedUpdatedAt },
    })
    act(() => root.unmount())
    client.clear()
  })
})

describe('useReloadWorkspaceFileContent', () => {
  const file: WorkspaceFileRecord = {
    id: 'file-1',
    workspaceId: 'ws-1',
    name: 'notes.md',
    key: 'workspace/ws-1/immutable-new-notes.md',
    path: '/notes.md',
    size: 12,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    uploadedAt: new Date('2026-09-03T20:00:00.000Z'),
    updatedAt: new Date('2026-09-03T20:00:01.000Z'),
    contentUpdatedAt: new Date('2026-09-03T20:00:01.000Z'),
  }
  let client: QueryClient
  let root: Root
  let mutation: ReturnType<typeof useReloadWorkspaceFileContent>

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: 3, retryDelay: 0 },
      },
    })
    root = createRoot(document.createElement('div'))
    mockRequestJson.mockResolvedValue({ success: true, file })
    function Probe() {
      mutation = useReloadWorkspaceFileContent()
      return null
    }
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    client.clear()
  })

  it.each([false, true])(
    'recovers matching bytes and version after key rotation (raw=%s)',
    async (raw) => {
      const nextFile = {
        ...file,
        key: 'workspace/ws-1/replacement.md',
        contentUpdatedAt: new Date('2026-09-03T20:00:02.000Z'),
      }
      client.setDefaultOptions({
        queries: { retry: 2, retryDelay: 0 },
        mutations: { retryDelay: 0 },
      })
      mockRequestJson
        .mockResolvedValueOnce({ success: true, file })
        .mockResolvedValueOnce({ success: true, file: nextFile })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('gone', { status: 404 }))
        .mockResolvedValueOnce(new Response('replacement bytes'))
      vi.stubGlobal('fetch', fetchMock)
      await act(async () => {
        await expect(
          mutation.mutateAsync({ workspaceId: 'ws-1', fileId: file.id, raw })
        ).resolves.toEqual({ file: nextFile, content: 'replacement bytes' })
      })
      expect(mockRequestJson).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(
        fetchMock.mock.calls.map(([url]) => new URL(url, 'http://localhost').pathname)
      ).toEqual(
        [file.key, nextFile.key].map((key) => `/api/files/serve/${encodeURIComponent(key)}`)
      )
      expect(
        client.getQueryData(
          workspaceFilesKeys.content('ws-1', file.id, raw ? 'raw' : 'text', nextFile.key)
        )
      ).toBe('replacement bytes')
    }
  )

  it.each([404, 500])(
    'propagates a %s byte failure without replacing cached bytes',
    async (status) => {
      const contentKey = workspaceFilesKeys.content('ws-1', file.id, 'text', file.key)
      client.setQueryData(contentKey, 'cached bytes')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('unavailable', { status }))
      )
      await act(async () => {
        await expect(
          mutation.mutateAsync({ workspaceId: 'ws-1', fileId: file.id, raw: false })
        ).rejects.toThrow(
          status === 404
            ? 'File content is no longer at the requested storage key'
            : 'Failed to fetch file content'
        )
      })
      expect(fetch).toHaveBeenCalledTimes(status === 404 ? 2 : 1)
      expect(mockRequestJson).toHaveBeenCalledTimes(status === 404 ? 2 : 1)
      expect(client.getQueryData(contentKey)).toBe('cached bytes')
    }
  )
})

/**
 * A content update rewrites the file under a NEW storage key and deletes the old object, so the key
 * held by an open tab goes dead — every few seconds while a collaborative document is being edited,
 * since the relay persists it server-side. These pin the two halves of the answer: don't create the
 * staleness where a server-side owner holds durability, and recover from it everywhere else.
 */
describe('useWorkspaceFileContent stale storage key', () => {
  afterEach(() => {
    focusManager.setFocused(undefined)
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
      expect.objectContaining({ type: 'active', predicate: expect.any(Function) }),
      { cancelRefetch: true }
    )
    // The RECORD is re-resolved, never this query — re-driving the read against the same dead key
    // is what would spin.
    expect(refetchQueries).toHaveBeenCalledTimes(1)
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
      return { success: true, file: { id: 'file-1', key: 'workspace/ws-1/123-abc-doc.md' } }
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    })
    const root: Root = createRoot(document.createElement('div'))
    let result: WorkspaceFileContentResult | undefined

    function Probe() {
      useWorkspaceFileRecord('ws-1', 'file-1')
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

describe('addressed file metadata fallback', () => {
  it('uses the authenticated detail contract and keeps uploads out of inventory cache', async () => {
    const file = {
      id: 'upload-1',
      workspaceId: 'ws-1',
      vfsNamespace: 'uploads',
      storageContext: 'workspace',
    }
    mockRequestJson.mockResolvedValue({ success: true, file })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    const root = createRoot(container)
    function Probe() {
      const record = useWorkspaceFileRecord('ws-1', 'upload-1')
      return <div>{record.data?.id}</div>
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      )
      await vi.waitFor(() =>
        expect(client.getQueryData(workspaceFilesKeys.record('ws-1', 'upload-1'))).toEqual(file)
      )
      expect(mockRequestJson).toHaveBeenCalledExactlyOnceWith(readWorkspaceFileContract, {
        params: { id: 'ws-1', fileId: 'upload-1' },
        signal: expect.any(AbortSignal),
      })
      expect(client.getQueryCache().findAll({ queryKey: workspaceFilesKeys.lists() })).toEqual([])
    } finally {
      act(() => root.unmount())
      client.clear()
    }
  })
})

function fileRecord(id: string, overrides: Partial<WorkspaceFileRecord> = {}): WorkspaceFileRecord {
  return {
    id,
    workspaceId: 'ws-1',
    name: `${id}.md`,
    key: `workspace/ws-1/${id}.md`,
    path: `/api/files/serve/workspace%2Fws-1%2F${id}.md`,
    size: 1,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    folderId: null,
    uploadedAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  }
}

/** Mounts `useHook` under a fresh client, exposing its latest result. */
function mountHook<T>(useHook: () => T) {
  return mountHookWith(
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
    useHook
  )
}

/** Mounts `useHook` under `client`, exposing its latest result. */
function mountHookWith<T>(client: QueryClient, useHook: () => T) {
  const root: Root = createRoot(document.createElement('div'))
  const state: { current?: T } = {}
  function Probe() {
    state.current = useHook()
    return null
  }
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  })
  return {
    client,
    result: () => {
      if (state.current === undefined) throw new Error('Hook did not render')
      return state.current
    },
    rerender: () =>
      act(() => {
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      }),
    unmount: () => {
      act(() => root.unmount())
      client.clear()
    },
  }
}

/** Answers list pages from `pages` in order, recording each request's query. */
function servePages(pages: { files: WorkspaceFileRecord[]; nextCursor: string | null }[]) {
  const queries: Record<string, unknown>[] = []
  mockRequestJson.mockImplementation(async (contract, input) => {
    if (contract !== listWorkspaceFilesContract) throw new Error('unexpected request')
    const query = (input as { query: Record<string, unknown> }).query
    queries.push(query)
    const index = query.cursor ? Number(String(query.cursor).replace('c', '')) : 0
    return { success: true, ...pages[index] }
  })
  return queries
}

describe('useWorkspaceFileList paging', () => {
  it('walks a folder a page at a time, resuming each page from the last cursor', async () => {
    const queries = servePages([
      { files: [fileRecord('a')], nextCursor: 'c1' },
      { files: [fileRecord('b')], nextCursor: null },
    ])
    const params = workspaceFileListParams({
      folderId: null,
      types: ['image', 'document', 'image'],
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 1,
    })
    const hook = mountHook(() => useWorkspaceFileList('ws-1', params))
    try {
      await vi.waitFor(() => expect(hook.result().data?.pages).toHaveLength(1))
      expect(hook.result().hasNextPage).toBe(true)
      await act(async () => {
        await hook.result().fetchNextPage()
      })
      await vi.waitFor(() => expect(hook.result().hasNextPage).toBe(false))
      expect(
        hook.result().data?.pages.flatMap((page) => page.files.map((file) => file.id))
      ).toEqual(['a', 'b'])
      expect(queries).toEqual([
        expect.objectContaining({ folderId: 'root', types: 'document,image', limit: 1 }),
        expect.objectContaining({ folderId: 'root', cursor: 'c1' }),
      ])
      expect(queries[0]).not.toHaveProperty('cursor')
    } finally {
      hook.unmount()
    }
  })

  it("restarts from the first page on a re-sort, showing the old rows until it lands, but never another folder's", async () => {
    const release = { current: () => {} }
    let call = 0
    mockRequestJson.mockImplementation(async (_contract, input) => {
      const query = (input as { query: Record<string, unknown> }).query
      call++
      if (call > 1) await new Promise<void>((resolve) => (release.current = resolve))
      return {
        success: true,
        files: [fileRecord(`${String(query.folderId)}-${String(query.sortBy)}`)],
        nextCursor: null,
      }
    })
    let params: WorkspaceFileListParams = workspaceFileListParams({
      folderId: null,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    })
    const hook = mountHook(() => useWorkspaceFileList('ws-1', params))
    try {
      await vi.waitFor(() => expect(hook.result().data).toBeDefined())

      params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
      hook.rerender()
      expect(hook.result().isPlaceholderData).toBe(true)
      expect(hook.result().data?.pages[0].files[0].id).toBe('root-updatedAt')
      await act(async () => release.current())
      await vi.waitFor(() => expect(hook.result().isPlaceholderData).toBe(false))
      expect(hook.result().data?.pages[0].files[0].id).toBe('root-name')
      expect(mockRequestJson.mock.calls[1][1]).not.toHaveProperty('query.cursor')

      params = workspaceFileListParams({ folderId: 'folder-2', sortBy: 'name', sortOrder: 'asc' })
      hook.rerender()
      expect(hook.result().data).toBeUndefined()
      await act(async () => release.current())
    } finally {
      hook.unmount()
    }
  })
})

describe('workspace file records', () => {
  it('opens a file from the list page it was clicked in, without a request', async () => {
    servePages([{ files: [fileRecord('a')], nextCursor: null }])
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    const list = mountHook(() => useWorkspaceFileList('ws-1', params))
    try {
      await vi.waitFor(() => expect(list.result().data).toBeDefined())
      mockRequestJson.mockClear()
      const record = mountHookWith(list.client, () => useWorkspaceFileRecord('ws-1', 'a'))
      expect(record.result().data?.id).toBe('a')
      await flushMacrotask()
      expect(mockRequestJson).not.toHaveBeenCalled()
      record.unmount()
    } finally {
      list.unmount()
    }
  })
})

describe('a file deleted while open', () => {
  it('reads as gone once its record 404s, not as the list copy it was opened from', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    client.setQueryData(workspaceFilesKeys.list('ws-1', params), {
      pages: [{ files: [fileRecord('a')], nextCursor: null }],
      pageParams: [null],
    })
    mockRequestJson.mockRejectedValue(
      new ApiClientError({ message: 'File not found', status: 404, body: {} })
    )
    const record = mountHookWith(client, () => useWorkspaceFileRecord('ws-1', 'a'))
    try {
      expect(record.result().data?.id).toBe('a')
      await act(async () => {
        await client.invalidateQueries({ queryKey: workspaceFilesKeys.record('ws-1', 'a') })
      })
      await vi.waitFor(() => expect(record.result().data).toBeNull())
    } finally {
      record.unmount()
    }
  })
})

describe('useRenameWorkspaceFile', () => {
  it('renames the file in every cached read at once, and restores them all when the rename fails', async () => {
    const hook = mountHook(() => useRenameWorkspaceFile())
    const { client } = hook
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    const searchKey = workspaceFilesKeys.search('ws-1', { q: 'a', limit: 20 })
    client.setQueryData(workspaceFilesKeys.list('ws-1', params), {
      pages: [{ files: [fileRecord('a'), fileRecord('b')], nextCursor: null }],
      pageParams: [null],
    })
    client.setQueryData(searchKey, [fileRecord('a')])
    client.setQueryData(workspaceFilesKeys.record('ws-1', 'a'), fileRecord('a'))
    const names = () => [
      (
        client.getQueryData(workspaceFilesKeys.list('ws-1', params)) as {
          pages: { files: WorkspaceFileRecord[] }[]
        }
      ).pages[0].files.map((file) => file.name),
      (client.getQueryData(searchKey) as WorkspaceFileRecord[])[0].name,
      (client.getQueryData(workspaceFilesKeys.record('ws-1', 'a')) as WorkspaceFileRecord).name,
    ]
    const rename = createDeferred<never>()
    mockRequestJson.mockImplementation((contract) =>
      contract === renameWorkspaceFileContract ? rename.promise : new Promise(() => {})
    )
    try {
      let settled: Promise<unknown> = Promise.resolve()
      act(() => {
        settled = hook
          .result()
          .mutateAsync({ workspaceId: 'ws-1', fileId: 'a', name: 'renamed.md' })
          .catch(() => {})
      })
      await vi.waitFor(() =>
        expect(names()).toEqual([['renamed.md', 'b.md'], 'renamed.md', 'renamed.md'])
      )
      await act(async () => {
        rename.reject(new Error('Name taken'))
        await settled
      })
      expect(names()).toEqual([['a.md', 'b.md'], 'a.md', 'a.md'])
    } finally {
      hook.unmount()
    }
  })
})

describe('invalidateWorkspaceFileBrowsers', () => {
  it('settles only once the mounted list and search reads have refetched', async () => {
    let listCalls = 0
    let searchCalls = 0
    const refetch = createDeferred<void>()
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === listWorkspaceFilesContract) {
        if (++listCalls > 1) await refetch.promise
        return { success: true, files: [fileRecord('a')], nextCursor: null }
      }
      if (contract === searchWorkspaceFilesContract) {
        searchCalls++
        return { success: true, files: [fileRecord('a')] }
      }
      return { success: true, folders: [] }
    })
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    const hook = mountHook(() => useWorkspaceFileList('ws-1', params))
    try {
      await vi.waitFor(() => expect(hook.result().data).toBeDefined())
      let done = false
      const invalidation = invalidateWorkspaceFileBrowsers(hook.client, 'ws-1').then(() => {
        done = true
      })
      await vi.waitFor(() => expect(listCalls).toBe(2))
      await flushMacrotask()
      expect(done).toBe(false)
      refetch.resolve()
      await invalidation
      expect(done).toBe(true)
      expect(searchCalls).toBe(0)
    } finally {
      hook.unmount()
    }
  })
})
