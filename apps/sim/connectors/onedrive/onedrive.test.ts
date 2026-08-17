/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ MicrosoftOneDriveIcon: () => null }))

import { onedriveConnector } from '@/connectors/onedrive/onedrive'

const GRAPH = 'https://graph.microsoft.com/v1.0'

interface GraphRoute {
  status?: number
  body?: unknown
}

function file(id: string, name: string, size = 10) {
  return {
    id,
    name,
    size,
    file: { mimeType: 'text/plain' },
    webUrl: `https://example.com/${id}`,
    lastModifiedDateTime: '2024-01-01T00:00:00Z',
  }
}

function folder(id: string, name: string) {
  return { id, name, folder: { childCount: 1 } }
}

/** Installs a URL-keyed fake Graph; unrouted URLs reply 404. */
function mockGraph(routes: Record<string, GraphRoute>) {
  const requested: string[] = []
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    requested.push(url)
    const route = routes[url] ?? { status: 404 }
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body ?? {}),
    } as unknown as Response
  })
  return requested
}

const ROOT_URL = `${GRAPH}/me/drive/root/children?$top=200&$select=id,name,webUrl,size,file,folder,lastModifiedDateTime,createdBy,parentReference`
const childrenUrl = (id: string) =>
  `${GRAPH}/me/drive/items/${id}/children?$top=200&$select=id,name,webUrl,size,file,folder,lastModifiedDateTime,createdBy,parentReference`

describe('onedrive listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('walks nested folders within a single call', async () => {
    const requested = mockGraph({
      [ROOT_URL]: { body: { value: [file('f1', 'a.txt'), folder('dir1', 'dir1')] } },
      [childrenUrl('dir1')]: { body: { value: [file('f2', 'b.md')] } },
    })

    const syncContext: Record<string, unknown> = {}
    const result = await onedriveConnector.listDocuments('token', {}, undefined, syncContext)

    expect(requested).toHaveLength(2)
    expect(result.documents.map((d) => d.externalId)).toEqual(['f1', 'f2'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('follows @odata.nextLink pages of the same folder', async () => {
    const nextLink = `${GRAPH}/me/drive/root/children?$skiptoken=abc`
    mockGraph({
      [ROOT_URL]: {
        body: { value: [file('f1', 'a.txt')], '@odata.nextLink': nextLink },
      },
      [nextLink]: { body: { value: [file('f2', 'b.txt')] } },
    })

    const syncContext: Record<string, unknown> = {}
    const result = await onedriveConnector.listDocuments('token', {}, undefined, syncContext)

    expect(result.documents.map((d) => d.externalId)).toEqual(['f1', 'f2'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when maxFiles lands exactly on source exhaustion', async () => {
    mockGraph({
      [ROOT_URL]: { body: { value: [file('f1', 'a.txt'), file('f2', 'b.txt')] } },
    })

    const syncContext: Record<string, unknown> = {}
    const result = await onedriveConnector.listDocuments(
      'token',
      { maxFiles: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when maxFiles hides items on the same page', async () => {
    mockGraph({
      [ROOT_URL]: { body: { value: [file('f1', 'a.txt'), file('f2', 'b.txt')] } },
    })

    const syncContext: Record<string, unknown> = {}
    const result = await onedriveConnector.listDocuments(
      'token',
      { maxFiles: '1' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when maxFiles lands on a page boundary with a nextLink left', async () => {
    const nextLink = `${GRAPH}/me/drive/root/children?$skiptoken=abc`
    mockGraph({
      [ROOT_URL]: {
        body: { value: [file('f1', 'a.txt')], '@odata.nextLink': nextLink },
      },
      [nextLink]: { body: { value: [file('f2', 'b.txt')] } },
    })

    const syncContext: Record<string, unknown> = {}
    const result = await onedriveConnector.listDocuments(
      'token',
      { maxFiles: '1' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when maxFiles stops traversal with folders pending', async () => {
    mockGraph({
      [ROOT_URL]: { body: { value: [file('f1', 'a.txt'), folder('dir1', 'dir1')] } },
      [childrenUrl('dir1')]: { body: { value: [file('f2', 'b.txt')] } },
    })

    const syncContext: Record<string, unknown> = {}
    await onedriveConnector.listDocuments('token', { maxFiles: '1' }, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })

  it('resumes from the cursor when the per-call request budget is exhausted', async () => {
    const routes: Record<string, GraphRoute> = {
      [ROOT_URL]: {
        body: { value: Array.from({ length: 30 }, (_, i) => folder(`dir${i}`, `dir${i}`)) },
      },
    }
    for (let i = 0; i < 30; i++) {
      routes[childrenUrl(`dir${i}`)] = { body: { value: [file(`f${i}`, `${i}.txt`)] } }
    }
    mockGraph(routes)

    const syncContext: Record<string, unknown> = {}
    const first = await onedriveConnector.listDocuments('token', {}, undefined, syncContext)

    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeDefined()

    const second = await onedriveConnector.listDocuments('token', {}, first.nextCursor, syncContext)

    expect(first.documents.length + second.documents.length).toBe(30)
    expect(second.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('encodes the configured folder path', async () => {
    const url = `${GRAPH}/me/drive/root:/My%20Docs/Q1%20%26%20Q2:/children?$top=200&$select=id,name,webUrl,size,file,folder,lastModifiedDateTime,createdBy,parentReference`
    const requested = mockGraph({ [url]: { body: { value: [] } } })

    await onedriveConnector.listDocuments(
      'token',
      { folderPath: '/My Docs/Q1 & Q2/' },
      undefined,
      {}
    )

    expect(requested[0]).toBe(url)
  })
})

describe('onedrive getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null on 404', async () => {
    mockGraph({})
    const doc = await onedriveConnector.getDocument!('token', {}, 'missing')
    expect(doc).toBeNull()
  })

  it('produces the same contentHash as the listing stub', async () => {
    const item = file('f1', 'a.txt')
    mockGraph({
      [ROOT_URL]: { body: { value: [item] } },
      [`${GRAPH}/me/drive/items/f1?$select=id,name,webUrl,size,file,folder,lastModifiedDateTime,createdBy,parentReference`]:
        { body: item },
    })

    const listed = await onedriveConnector.listDocuments('token', {}, undefined, {})

    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (url.endsWith('/content')) {
        return {
          ok: true,
          status: 200,
          body: null,
          arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => item,
        text: async () => '',
      } as unknown as Response
    })

    const fetched = await onedriveConnector.getDocument!('token', {}, 'f1')

    expect(fetched?.contentHash).toBe(listed.documents[0].contentHash)
    expect(fetched?.contentDeferred).toBe(false)
    expect(fetched?.content).toBe('hello')
  })
})
