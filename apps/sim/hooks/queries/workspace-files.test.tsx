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
  MAX_WORKSPACE_FILE_FOLDER_STATS_PARENTS,
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
  useWorkspaceFileFolderSizes,
  useWorkspaceFileList,
  useWorkspaceFilePickerOptions,
  useWorkspaceFileRecord,
  useWorkspaceFileSearch,
  useWorkspaceImageDimensionsAdapter,
  type WorkspaceFileContentResult,
  workspaceFileRecordState,
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
    /** Only the reads that can hold this file's key: its record and the lookups that found it. */
    const record = workspaceFilesKeys.record('ws-1', 'file-1')
    const lookup = workspaceFilesKeys.lookup('ws-1', 'reference', 'doc.md')
    queryClient.setQueryData(record, fileRecord('file-1'))
    queryClient.setQueryData(lookup, fileRecord('file-1'))
    queryClient.setQueryData(workspaceFilesKeys.lookup('ws-1', 'id', 'other'), fileRecord('other'))
    queryClient.setQueryData(workspaceFilesKeys.record('ws-1', 'other'), fileRecord('other'))
    queryClient.setQueryData(workspaceFilesKeys.search('ws-1', { q: 'doc', limit: 20 }), [
      fileRecord('file-1'),
    ])
    const [filter] = refetchQueries.mock.calls[0]
    expect(
      queryClient
        .getQueryCache()
        .findAll({ ...filter, type: 'all' })
        .map((query) => query.queryKey)
    ).toEqual(expect.arrayContaining([record, lookup]))
    expect(queryClient.getQueryCache().findAll({ ...filter, type: 'all' })).toHaveLength(2)
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
      act(() => hook.result().loadMore())
      await vi.waitFor(() => expect(hook.result().hasNextPage).toBe(false))
      expect(hook.result().data?.files.map((file) => file.id)).toEqual(['a', 'b'])
      expect(queries).toEqual([
        expect.objectContaining({ folderId: 'root', types: ['document', 'image'], limit: 1 }),
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
  it('renames the file where it is addressed by identity at once, and restores it when the rename fails', async () => {
    const hook = mountHook(() => useRenameWorkspaceFile())
    const { client } = hook
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    const listKey = workspaceFilesKeys.list('ws-1', params)
    const recordKey = workspaceFilesKeys.record('ws-1', 'a')
    const lookupKey = workspaceFilesKeys.lookup('ws-1', 'id', 'a')
    const list = {
      pages: [{ files: [fileRecord('a'), fileRecord('b')], nextCursor: null }],
      pageParams: [null],
    }
    client.setQueryData(listKey, list)
    client.setQueryData(recordKey, fileRecord('a'))
    client.setQueryData(lookupKey, fileRecord('a'))
    const name = (key: readonly unknown[]) =>
      (client.getQueryData(key) as WorkspaceFileRecord | undefined)?.name
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
      await vi.waitFor(() => expect(name(recordKey)).toBe('renamed.md'))
      expect(name(lookupKey)).toBe('renamed.md')
      /** The list keeps the server's copy: rewriting it would leave the file at its old position. */
      expect(client.getQueryData(listKey)).toBe(list)
      await act(async () => {
        rename.reject(new Error('Name taken'))
        await settled
      })
      expect(name(recordKey)).toBe('a.md')
      expect(name(lookupKey)).toBe('a.md')
    } finally {
      hook.unmount()
    }
  })

  it('refetches lists and searches once a rename lands, so the file takes its new position and leaves a search it no longer matches', async () => {
    let renamed = false
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === renameWorkspaceFileContract) {
        renamed = true
        return { success: true, file: fileRecord('a', { name: 'z.md' }) }
      }
      if (contract === listWorkspaceFilesContract) {
        const files = renamed
          ? [fileRecord('b'), fileRecord('a', { name: 'z.md' })]
          : [fileRecord('a'), fileRecord('b')]
        return { success: true, files, nextCursor: null }
      }
      if (contract === searchWorkspaceFilesContract) {
        return { success: true, files: renamed ? [] : [fileRecord('a')] }
      }
      return new Promise(() => {})
    })
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    const hook = mountHook(() => ({
      rename: useRenameWorkspaceFile(),
      list: useWorkspaceFileList('ws-1', params),
      search: useWorkspaceFileSearch('ws-1', { q: 'a', limit: 20 }),
    }))
    try {
      await vi.waitFor(() => expect(hook.result().search.data).toHaveLength(1))
      await vi.waitFor(() => expect(hook.result().list.data?.files).toHaveLength(2))
      await act(async () => {
        await hook.result().rename.mutateAsync({ workspaceId: 'ws-1', fileId: 'a', name: 'z.md' })
      })
      /** Settled only once the mounted reads refetched: the edit closes onto the server's order. */
      const list = hook.client.getQueryData<{ pages: { files: WorkspaceFileRecord[] }[] }>(
        workspaceFilesKeys.list('ws-1', params)
      )
      expect(list?.pages[0].files.map((file) => file.name)).toEqual(['b.md', 'z.md'])
      expect(
        hook.client.getQueryData(workspaceFilesKeys.search('ws-1', { q: 'a', limit: 20 }))
      ).toEqual([])
    } finally {
      hook.unmount()
    }
  })
})

describe('invalidateWorkspaceFileBrowsers', () => {
  it('settles only once the mounted list and search reads have refetched', async () => {
    let listCalls = 0
    let searchCalls = 0
    const listRefetch = createDeferred<void>()
    const searchRefetch = createDeferred<void>()
    mockRequestJson.mockImplementation(async (contract) => {
      if (contract === listWorkspaceFilesContract) {
        if (++listCalls > 1) await listRefetch.promise
        return { success: true, files: [fileRecord('a')], nextCursor: null }
      }
      if (contract === searchWorkspaceFilesContract) {
        if (++searchCalls > 1) await searchRefetch.promise
        return { success: true, files: [fileRecord('a')] }
      }
      return { success: true, folders: [] }
    })
    const params = workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
    const hook = mountHook(() => ({
      list: useWorkspaceFileList('ws-1', params),
      search: useWorkspaceFileSearch('ws-1', { q: 'a', limit: 20 }),
    }))
    try {
      await vi.waitFor(() => expect(hook.result().list.data).toBeDefined())
      await vi.waitFor(() => expect(hook.result().search.data).toBeDefined())
      let done = false
      const invalidation = invalidateWorkspaceFileBrowsers(hook.client, 'ws-1').then(() => {
        done = true
      })
      await vi.waitFor(() => expect([listCalls, searchCalls]).toEqual([2, 2]))
      listRefetch.resolve()
      await flushMacrotask()
      expect(done).toBe(false)
      searchRefetch.resolve()
      await invalidation
      expect(done).toBe(true)
    } finally {
      hook.unmount()
    }
  })
})

describe('useUpdateWorkspaceFileContent cache writes', () => {
  it('writes the saved record through every read holding it and refetches only the listings', async () => {
    const saved = fileRecord('a', { key: 'workspace/ws-1/a-v2.md', size: 9 })
    mockRequestJson.mockImplementation(async (contract) =>
      contract === updateWorkspaceFileContentContract
        ? { success: true, file: saved }
        : new Promise(() => {})
    )
    const hook = mountHook(() => useUpdateWorkspaceFileContent())
    const { client } = hook
    const recordKey = workspaceFilesKeys.record('ws-1', 'a')
    const searchKey = workspaceFilesKeys.search('ws-1', { q: 'a', limit: 20 })
    const listKey = workspaceFilesKeys.list(
      'ws-1',
      workspaceFileListParams({ folderId: null, sortBy: 'size', sortOrder: 'asc' })
    )
    client.setQueryData(recordKey, fileRecord('a'))
    client.setQueryData(searchKey, [fileRecord('a')])
    client.setQueryData(listKey, {
      pages: [{ files: [fileRecord('a')], nextCursor: null }],
      pageParams: [null],
    })
    try {
      await act(async () => {
        await hook.result().mutateAsync({ workspaceId: 'ws-1', fileId: 'a', content: 'x' })
      })
      expect(client.getQueryData(recordKey)).toEqual(saved)
      expect(client.getQueryData(searchKey)).toEqual([saved])
      expect(client.getQueryState(recordKey)?.isInvalidated).toBe(false)
      expect(client.getQueryState(searchKey)?.isInvalidated).toBe(true)
      expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
    } finally {
      hook.unmount()
    }
  })
})

describe('useWorkspaceFileFolderSizes', () => {
  it('reads the child folders of every parent in one request', async () => {
    const queries: Record<string, unknown>[] = []
    mockRequestJson.mockImplementation(async (_contract, input) => {
      queries.push((input as { query: Record<string, unknown> }).query)
      return {
        success: true,
        folders: [
          { folderId: 'f1', fileCount: 1, sizeBytes: 10 },
          { folderId: 'f2', fileCount: 2, sizeBytes: 20 },
        ],
      }
    })
    const parents = ['folder-b', null, 'folder-b']
    const hook = mountHook(() => useWorkspaceFileFolderSizes('ws-1', parents))
    try {
      await vi.waitFor(() => expect(hook.result().get('f2')?.sizeBytes).toBe(20))
      expect(queries).toEqual([{ parentIds: ['folder-b', 'root'] }])
    } finally {
      hook.unmount()
    }
  })
})

describe('useWorkspaceFileFolderSizes across many parents', () => {
  it('splits parents past the per-request cap into several requests and merges them', async () => {
    const queries: string[][] = []
    mockRequestJson.mockImplementation(async (_contract, input) => {
      const { parentIds } = (input as { query: { parentIds: string[] } }).query
      queries.push(parentIds)
      return {
        success: true,
        folders: parentIds.map((parentId) => ({
          folderId: `child-of-${parentId}`,
          fileCount: 1,
          sizeBytes: 1,
        })),
      }
    })
    const parents = Array.from(
      { length: MAX_WORKSPACE_FILE_FOLDER_STATS_PARENTS + 1 },
      (_, index) => `p${String(index).padStart(3, '0')}`
    )
    const hook = mountHook(() => useWorkspaceFileFolderSizes('ws-1', parents))
    try {
      await vi.waitFor(() => expect(hook.result().size).toBe(parents.length))
      expect(queries.map((chunk) => chunk.length)).toEqual([
        MAX_WORKSPACE_FILE_FOLDER_STATS_PARENTS,
        1,
      ])
    } finally {
      hook.unmount()
    }
  })
})

describe('useWorkspaceFilePickerOptions', () => {
  it('offers the most recent files untyped and the server matches once a query settles', async () => {
    mockRequestJson.mockImplementation(async (contract) =>
      contract === searchWorkspaceFilesContract
        ? { success: true, files: [fileRecord('match')] }
        : { success: true, files: [fileRecord('recent')], nextCursor: null }
    )
    let query = ''
    const hook = mountHook(() => useWorkspaceFilePickerOptions('ws-1', query))
    try {
      await vi.waitFor(() =>
        expect(hook.result().files?.map((file) => file.id)).toEqual(['recent'])
      )
      query = '  mat '
      hook.rerender()
      /** Typed but not settled: still pending, so an empty menu is not read as "no match". */
      expect(hook.result().isPending).toBe(true)
      await vi.waitFor(() => expect(hook.result().files?.map((file) => file.id)).toEqual(['match']))
      expect(hook.result().matchedQuery).toBe('mat')
      expect(hook.result().isPending).toBe(false)
    } finally {
      hook.unmount()
    }
  })

  it('claims no matched query while the last query’s matches stand in for the next', async () => {
    const next = createDeferred<unknown>()
    mockRequestJson.mockImplementation(async (contract, input) => {
      if (contract !== searchWorkspaceFilesContract) {
        return { success: true, files: [], nextCursor: null }
      }
      const { q } = (input as { query: { q: string } }).query
      return q === 'mat' ? { success: true, files: [fileRecord('match')] } : next.promise
    })
    let query = 'mat'
    const hook = mountHook(() => useWorkspaceFilePickerOptions('ws-1', query))
    try {
      await vi.waitFor(() => expect(hook.result().matchedQuery).toBe('mat'))
      query = 'other'
      hook.rerender()
      await vi.waitFor(() => expect(mockRequestJson).toHaveBeenCalledTimes(3))
      expect(hook.result().files?.map((file) => file.id)).toEqual(['match'])
      expect(hook.result().matchedQuery).toBe('')
    } finally {
      hook.unmount()
    }
  })
})

describe('useWorkspaceImageDimensionsAdapter', () => {
  it('re-runs the image reads once its own lookup lands on a cold load, not for other lookups', async () => {
    const image = fileRecord('img', {
      key: 'workspace/ws-1/1731-ab-img.png',
      width: 40,
      height: 30,
    })
    const lookup = createDeferred<unknown>()
    mockRequestJson.mockImplementation(() => lookup.promise)
    const src = `/api/files/serve/${encodeURIComponent(image.key)}?context=workspace`
    const hook = mountHook(() => useWorkspaceImageDimensionsAdapter('ws-1'))
    try {
      const cold = hook.result()
      expect(cold.getImageDimensions(src)).toBeNull()
      act(() => {
        hook.client.setQueryData(workspaceFilesKeys.lookup('ws-1', 'id', 'unrelated'), null)
      })
      expect(hook.result()).toBe(cold)
      await act(async () => {
        lookup.resolve({ success: true, files: [image], references: [] })
        await flushMacrotask()
      })
      await vi.waitFor(() => expect(hook.result()).not.toBe(cold))
      expect(hook.result().getImageDimensions(src)).toEqual({ width: 40, height: 30 })
    } finally {
      hook.unmount()
    }
  })
})

describe('useWorkspaceFileSearch placeholder', () => {
  it("keeps the last matches while a new query loads, but never another workspace's", async () => {
    const pending = createDeferred<unknown>()
    mockRequestJson.mockImplementation(async (_contract, input) => {
      const { q } = (input as { query: { q: string } }).query
      if (q === 'first') return { success: true, files: [fileRecord('first')] }
      return pending.promise
    })
    let workspaceId = 'ws-1'
    let q = 'first'
    const hook = mountHook(() => useWorkspaceFileSearch(workspaceId, { q, limit: 20 }))
    try {
      await vi.waitFor(() => expect(hook.result().data?.[0]?.id).toBe('first'))
      q = 'second'
      hook.rerender()
      expect(hook.result().data?.[0]?.id).toBe('first')
      workspaceId = 'ws-2'
      hook.rerender()
      expect(hook.result().data).toBeUndefined()
    } finally {
      hook.unmount()
    }
  })
})

describe('useWorkspaceImageDimensionsAdapter encoded ids', () => {
  it('looks an image up by its stored id when the document percent-encodes it', async () => {
    const image = fileRecord('wf_img', { width: 40, height: 30 })
    const bodies: unknown[] = []
    mockRequestJson.mockImplementation(async (_contract, input) => {
      bodies.push((input as { body: unknown }).body)
      return { success: true, files: [image], references: [] }
    })
    const src = '/api/files/view/wf%5Fimg'
    const hook = mountHook(() => useWorkspaceImageDimensionsAdapter('ws-1'))
    try {
      expect(hook.result().getImageDimensions(src)).toBeNull()
      await vi.waitFor(() =>
        expect(hook.result().getImageDimensions(src)).toEqual({ width: 40, height: 30 })
      )
      expect(bodies).toEqual([expect.objectContaining({ ids: ['wf_img'] })])
    } finally {
      hook.unmount()
    }
  })
})

describe('workspaceFileRecordState', () => {
  it('reads only a 404 (a null record) as missing, and any other failure as failed', () => {
    expect(workspaceFileRecordState({ data: null, isError: false })).toBe('missing')
    expect(workspaceFileRecordState({ data: undefined, isError: true })).toBe('failed')
  })

  it('keeps a record in hand found though its refetch failed, and waits on a first read', () => {
    expect(workspaceFileRecordState({ data: fileRecord('a'), isError: true })).toBe('found')
    expect(workspaceFileRecordState({ data: undefined, isError: false })).toBe('loading')
  })
})
