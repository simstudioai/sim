import { jsonResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asanaConnector, decideTaskCap } from '@/connectors/asana/asana'

const _baseTask = { gid: 't1', name: 'Task', completed: false }

describe('decideTaskCap', () => {
  it.concurrent('reports truncation when the page is sliced to the cap', () => {
    expect(decideTaskCap(10, 4, 20, false)).toEqual({
      keepCount: 6,
      hitLimit: true,
      truncated: true,
    })
  })

  it.concurrent('reports truncation when the cap stops unread pages', () => {
    expect(decideTaskCap(10, 0, 10, true)).toEqual({
      keepCount: 10,
      hitLimit: true,
      truncated: true,
    })
  })

  it.concurrent('does not report truncation when the cap coincides with the last page', () => {
    expect(decideTaskCap(10, 0, 10, false)).toEqual({
      keepCount: 10,
      hitLimit: true,
      truncated: false,
    })
  })

  it.concurrent('never returns a negative keep count when already past the cap', () => {
    expect(decideTaskCap(10, 12, 5, true)).toEqual({
      keepCount: 0,
      hitLimit: true,
      truncated: true,
    })
  })
})

function _errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(),
    json: async () => ({}),
    text: async () => 'boom',
  } as unknown as Response
}

const mockFetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

describe('asanaConnector.listDocuments', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  const requestedUrls = () => mockFetch.mock.calls.map(([url]) => url)

  it('keeps paginating projects when an entire page filters to empty', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        if (url.includes('offset=page2')) {
          return jsonResponse({
            data: [{ gid: 'p9', name: 'Live', archived: false }],
            next_page: null,
          })
        }
        return jsonResponse({
          data: [
            { gid: 'p1', name: 'Old', archived: true },
            { gid: 'p2', name: 'Older', archived: true },
          ],
          next_page: { offset: 'page2' },
        })
      }
      return jsonResponse({ data: [], next_page: null })
    })

    const syncContext: Record<string, unknown> = {}
    await asanaConnector.listDocuments('token', { workspace: 'w1' }, undefined, syncContext)

    expect(syncContext.projectGids).toEqual(['p9'])
    expect(requestedUrls().filter((url) => url.includes('/projects')).length).toBe(2)
  })

  it('flags listingCapped when maxTasks truncates the listing', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        return jsonResponse({ data: [{ gid: 'p1', name: 'Live' }], next_page: null })
      }
      return jsonResponse({
        data: [
          { gid: 't1', name: 'One', completed: false },
          { gid: 't2', name: 'Two', completed: false },
          { gid: 't3', name: 'Three', completed: false },
        ],
        next_page: { offset: 'next', uri: 'x' },
      })
    })

    const syncContext: Record<string, unknown> = {}
    const result = await asanaConnector.listDocuments(
      'token',
      { workspace: 'w1', maxTasks: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBe(true)
  })

  it('stops after the per-call request budget and hands back a resumable cursor', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        return jsonResponse({
          data: Array.from({ length: 40 }, (_, i) => ({ gid: `p${i}`, name: `P${i}` })),
          next_page: null,
        })
      }
      return jsonResponse({ data: [], next_page: null })
    })

    const syncContext: Record<string, unknown> = {}
    const result = await asanaConnector.listDocuments(
      'token',
      { workspace: 'w1' },
      undefined,
      syncContext
    )

    expect(requestedUrls().filter((url) => url.includes('/tasks?')).length).toBe(25)
    expect(result.hasMore).toBe(true)
    expect(JSON.parse(result.nextCursor as string)).toEqual({ projectIndex: 25 })
    expect(syncContext.listingCapped).toBeUndefined()
  })
})

describe('asanaConnector.getDocument', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('returns null for a task whose every project is archived', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          gid: 't1',
          name: 'One',
          completed: false,
          projects: [{ gid: 'p1', name: 'Old', archived: true }],
        },
      })
    )

    expect(await asanaConnector.getDocument('token', {}, 't1')).toBeNull()
  })

  it('fails open and returns the task when the archived flag is missing', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          gid: 't1',
          name: 'One',
          completed: false,
          projects: [{ gid: 'p1', name: 'Unknown' }],
        },
      })
    )

    const doc = await asanaConnector.getDocument('token', {}, 't1')
    expect(doc?.externalId).toBe('t1')
  })
})
