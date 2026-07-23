/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asanaConnector,
  buildProjectsPath,
  decideTaskCap,
  isActiveProject,
  isTaskUnderActiveProject,
} from '@/connectors/asana/asana'

describe('buildProjectsPath', () => {
  it.concurrent('always filters out archived projects', () => {
    expect(buildProjectsPath('123')).toContain('archived=false')
  })

  it.concurrent('scopes the listing to the workspace with a page size', () => {
    const path = buildProjectsPath('123')
    expect(path.startsWith('/projects?')).toBe(true)
    expect(path).toContain('workspace=123')
    expect(path).toContain('limit=100')
  })

  it.concurrent('requests the archived field so it can be re-checked client side', () => {
    expect(buildProjectsPath('123')).toContain('opt_fields=gid,name,archived')
  })

  it.concurrent('omits the offset param on the first page', () => {
    expect(buildProjectsPath('123')).not.toContain('offset=')
  })

  it.concurrent('appends the offset token when paginating', () => {
    expect(buildProjectsPath('123', 'abc:def')).toContain('offset=abc%3Adef')
  })

  it.concurrent('keeps the archived filter on paginated requests', () => {
    expect(buildProjectsPath('123', 'abc')).toContain('archived=false')
  })
})

describe('isActiveProject', () => {
  it.concurrent('keeps projects explicitly marked as not archived', () => {
    expect(isActiveProject({ gid: '1', name: 'Roadmap', archived: false })).toBe(true)
  })

  it.concurrent('keeps projects with no archived field', () => {
    expect(isActiveProject({ gid: '1', name: 'Roadmap' })).toBe(true)
  })

  it.concurrent('excludes explicitly archived projects', () => {
    expect(isActiveProject({ gid: '1', name: 'Roadmap', archived: true })).toBe(false)
  })

  it.concurrent('keeps projects whose archived flag is a non-boolean truthy value', () => {
    expect(
      isActiveProject({ gid: '1', name: 'Roadmap', archived: 'true' } as unknown as {
        gid: string
        name: string
        archived?: boolean
      })
    ).toBe(true)
  })
})

const baseTask = { gid: 't1', name: 'Task', completed: false }

describe('isTaskUnderActiveProject', () => {
  it.concurrent('keeps a task with no projects field', () => {
    expect(isTaskUnderActiveProject(baseTask)).toBe(true)
  })

  it.concurrent('keeps a task with an empty projects array', () => {
    expect(isTaskUnderActiveProject({ ...baseTask, projects: [] })).toBe(true)
  })

  it.concurrent('keeps a task in at least one active project', () => {
    expect(
      isTaskUnderActiveProject({
        ...baseTask,
        projects: [
          { gid: 'p1', name: 'Old', archived: true },
          { gid: 'p2', name: 'Live', archived: false },
        ],
      })
    ).toBe(true)
  })

  it.concurrent('excludes a task whose every project is archived', () => {
    expect(
      isTaskUnderActiveProject({
        ...baseTask,
        projects: [
          { gid: 'p1', name: 'Old', archived: true },
          { gid: 'p2', name: 'Older', archived: true },
        ],
      })
    ).toBe(false)
  })

  it.concurrent('keeps a task when one project omits the archived field', () => {
    expect(
      isTaskUnderActiveProject({
        ...baseTask,
        projects: [
          { gid: 'p1', name: 'Old', archived: true },
          { gid: 'p2', name: 'Unknown' },
        ],
      })
    ).toBe(true)
  })

  it.concurrent('keeps a task when archived is a non-boolean truthy value', () => {
    expect(
      isTaskUnderActiveProject({
        ...baseTask,
        projects: [{ gid: 'p1', name: 'Old', archived: 'true' }],
      } as unknown as typeof baseTask)
    ).toBe(true)
  })
})

describe('decideTaskCap', () => {
  it.concurrent('keeps everything and reports no cap when maxTasks is unset', () => {
    expect(decideTaskCap(0, 0, 50, true)).toEqual({
      keepCount: 50,
      hitLimit: false,
      truncated: false,
    })
  })

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

  it.concurrent('does not report truncation below the cap', () => {
    expect(decideTaskCap(10, 2, 3, false)).toEqual({
      keepCount: 3,
      hitLimit: false,
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

/**
 * Minimal JSON response stub for the mocked global fetch.
 */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function errorResponse(status: number): Response {
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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const requestedUrls = () => mockFetch.mock.calls.map(([url]) => url)

  it('requests the archived filter and drops archived projects from the listing', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        return jsonResponse({
          data: [
            { gid: 'p1', name: 'Live', archived: false },
            { gid: 'p2', name: 'Old', archived: true },
          ],
          next_page: null,
        })
      }
      return jsonResponse({ data: [], next_page: null })
    })

    const syncContext: Record<string, unknown> = {}
    await asanaConnector.listDocuments('token', { workspace: 'w1' }, undefined, syncContext)

    expect(requestedUrls()[0]).toContain('archived=false')
    expect(syncContext.projectGids).toEqual(['p1'])
    expect(requestedUrls().some((url) => url.includes('project=p2'))).toBe(false)
  })

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

  it('flags listingCapped when the cap lands exactly on a page with more pages left', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        return jsonResponse({ data: [{ gid: 'p1', name: 'Live' }], next_page: null })
      }
      return jsonResponse({
        data: [
          { gid: 't1', name: 'One', completed: false },
          { gid: 't2', name: 'Two', completed: false },
        ],
        next_page: { offset: 'next', uri: 'x' },
      })
    })

    const syncContext: Record<string, unknown> = {}
    await asanaConnector.listDocuments(
      'token',
      { workspace: 'w1', maxTasks: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset when the source is exhausted within the cap', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        return jsonResponse({ data: [{ gid: 'p1', name: 'Live' }], next_page: null })
      }
      return jsonResponse({
        data: [{ gid: 't1', name: 'One', completed: false }],
        next_page: null,
      })
    })

    const syncContext: Record<string, unknown> = {}
    const result = await asanaConnector.listDocuments(
      'token',
      { workspace: 'w1', maxTasks: '50' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when no cap is configured', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/projects')) {
        return jsonResponse({ data: [{ gid: 'p1', name: 'Live' }], next_page: null })
      }
      return jsonResponse({
        data: [{ gid: 't1', name: 'One', completed: false }],
        next_page: null,
      })
    })

    const syncContext: Record<string, unknown> = {}
    await asanaConnector.listDocuments('token', { workspace: 'w1' }, undefined, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('keeps syncing an explicitly pinned project without listing workspace projects', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse({ data: [{ gid: 't1', name: 'One', completed: false }], next_page: null })
    )

    await asanaConnector.listDocuments('token', { workspace: 'w1', project: 'p7' }, undefined, {})

    expect(requestedUrls().some((url) => url.includes('/projects?'))).toBe(false)
    expect(requestedUrls()[0]).toContain('project=p7')
  })
})

describe('asanaConnector.getDocument', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the parent projects so the archived check can run', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data: { gid: 't1', name: 'One', completed: false } })
    )

    await asanaConnector.getDocument('token', {}, 't1')

    expect(mockFetch.mock.calls[0][0]).toContain('projects.archived')
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

  it('returns the task when at least one parent project is still active', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          gid: 't1',
          name: 'One',
          completed: false,
          projects: [
            { gid: 'p1', name: 'Old', archived: true },
            { gid: 'p2', name: 'Live', archived: false },
          ],
        },
      })
    )

    const doc = await asanaConnector.getDocument('token', {}, 't1')
    expect(doc?.externalId).toBe('t1')
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

  it('returns null when the task fetch fails', async () => {
    mockFetch.mockResolvedValue(errorResponse(404))

    expect(await asanaConnector.getDocument('token', {}, 't1')).toBeNull()
  })
})
