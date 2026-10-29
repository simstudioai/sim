import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { createWorkspaceFileLookupBatcher } from '@/hooks/queries/utils/workspace-file-lookup-batcher'

interface LookupBody {
  ids?: string[]
  keys?: string[]
  references?: string[]
}

function record(id: string, key = `workspace/ws-1/${id}`): WorkspaceFileRecord {
  return {
    id,
    workspaceId: 'ws-1',
    name: `${id}.md`,
    key,
    path: `/api/files/serve/${key}`,
    size: 1,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    folderId: null,
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
  }
}

/** A lookup endpoint over `files`, answering references by id only, as the real one does first. */
function serve(files: WorkspaceFileRecord[]) {
  return vi.fn(async (_workspaceId: string, body: LookupBody) => ({
    files: files.filter(
      (file) =>
        body.ids?.includes(file.id) ||
        body.keys?.includes(file.key) ||
        body.references?.includes(file.id)
    ),
    references: (body.references ?? []).map((reference) => ({
      reference,
      fileId: files.find((file) => file.id === reference)?.id ?? null,
    })),
  }))
}

describe('createWorkspaceFileLookupBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the lookups of one task as one request per workspace, each value once', async () => {
    const a = record('wf_a')
    const b = record('wf_b')
    const fetchLookup = serve([a, b])
    const batcher = createWorkspaceFileLookupBatcher(fetchLookup)

    const results = Promise.all([
      batcher.load('ws-1', 'id', a.id),
      batcher.load('ws-1', 'id', a.id),
      batcher.load('ws-1', 'key', b.key),
      batcher.load('ws-1', 'reference', b.id),
      batcher.load('ws-1', 'id', 'wf_missing'),
      batcher.load('ws-2', 'id', a.id),
    ])
    await vi.runAllTimersAsync()

    expect(await results).toEqual([a, a, b, b, null, a])
    expect(fetchLookup).toHaveBeenCalledTimes(2)
    expect(fetchLookup).toHaveBeenCalledWith('ws-1', {
      ids: [a.id, 'wf_missing'],
      keys: [b.key],
      references: [b.id],
    })
    expect(fetchLookup).toHaveBeenCalledWith('ws-2', { ids: [a.id] })
  })

  it('splits a kind past the per-request cap across requests, resolving every value', async () => {
    const files = Array.from({ length: 150 }, (_, index) => record(`wf_${index}`))
    const fetchLookup = serve(files)
    const batcher = createWorkspaceFileLookupBatcher(fetchLookup)

    const results = Promise.all(files.map((file) => batcher.load('ws-1', 'id', file.id)))
    await vi.runAllTimersAsync()

    expect(await results).toEqual(files)
    expect(fetchLookup.mock.calls.map(([, body]) => body.ids?.length)).toEqual([100, 50])
  })

  it('drops a lookup aborted before its batch is sent, and rejects one aborted after alone', async () => {
    const a = record('wf_a')
    const b = record('wf_b')
    const response = createDeferred<{
      files: WorkspaceFileRecord[]
      references: { reference: string; fileId: string | null }[]
    }>()
    const fetchLookup = vi.fn(() => response.promise)
    const batcher = createWorkspaceFileLookupBatcher(fetchLookup)
    const early = new AbortController()
    const late = new AbortController()

    const dropped = batcher.load('ws-1', 'id', a.id, early.signal)
    const abandoned = batcher.load('ws-1', 'id', b.id, late.signal)
    const kept = batcher.load('ws-1', 'id', b.id)
    early.abort()
    await expect(dropped).rejects.toBe(early.signal.reason)
    await vi.runAllTimersAsync()
    expect(fetchLookup).toHaveBeenCalledExactlyOnceWith('ws-1', { ids: [b.id] })

    late.abort()
    await expect(abandoned).rejects.toBe(late.signal.reason)
    response.resolve({ files: [b], references: [] })
    expect(await kept).toBe(b)
  })

  it('answers a value the endpoint would refuse with no file, keeping it out of the shared request', async () => {
    const a = record('wf_a')
    const fetchLookup = serve([a])
    const batcher = createWorkspaceFileLookupBatcher(fetchLookup)

    const results = Promise.all([
      batcher.load('ws-1', 'key', 'x'.repeat(1025)),
      batcher.load('ws-1', 'reference', ''),
      batcher.load('ws-1', 'id', a.id),
    ])
    await vi.runAllTimersAsync()

    expect(await results).toEqual([null, null, a])
    expect(fetchLookup).toHaveBeenCalledExactlyOnceWith('ws-1', { ids: [a.id] })
  })

  it('rejects the waiters of a failed request only', async () => {
    const a = record('wf_a')
    const fetchLookup = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'ws-down') throw new Error('lookup failed')
      return { files: [a], references: [] }
    })
    const batcher = createWorkspaceFileLookupBatcher(fetchLookup)

    const failed = batcher.load('ws-down', 'id', a.id)
    const served = batcher.load('ws-1', 'id', a.id)
    failed.catch(() => {})
    await vi.runAllTimersAsync()
    await flushMicrotasks()

    await expect(failed).rejects.toThrow('lookup failed')
    expect(await served).toBe(a)
  })
})
