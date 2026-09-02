/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  readBoundedHttpErrorBody: async (response: Response) => response.text(),
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ MicrosoftOneDriveIcon: () => null }))

import { onedriveConnector } from '@/connectors/onedrive/onedrive'
import {
  encodeMicrosoftGraphTraversalCursor,
  MICROSOFT_GRAPH_MAX_PENDING_FOLDERS,
} from '@/connectors/utils'

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

const ROOT_URL = `${GRAPH}/me/drive/root/children?$top=200&$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`
const childrenUrl = (id: string) =>
  `${GRAPH}/me/drive/items/${id}/children?$top=200&$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`

describe('onedrive listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a malformed successful list envelope', async () => {
    mockGraph({ [ROOT_URL]: { body: {} } })

    await expect(onedriveConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow(
      'Microsoft Graph returned malformed OneDrive list metadata'
    )
  })

  it.each([
    { value: [{ id: 'f1', name: 'Missing facet' }] },
    { value: [], '@odata.nextLink': 'https://evil.example/items' },
  ])('rejects ambiguous or unsafe list metadata', async (body) => {
    mockGraph({ [ROOT_URL]: { body } })

    await expect(onedriveConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow()
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

  it('does not retain irrelevant folders after maxFiles has stopped traversal', async () => {
    mockGraph({
      [ROOT_URL]: { body: { value: [file('f1', 'a.txt'), folder('overflow', 'overflow')] } },
    })
    const cursor = encodeMicrosoftGraphTraversalCursor(
      {
        folderStack: Array.from(
          { length: MICROSOFT_GRAPH_MAX_PENDING_FOLDERS },
          (_, index) => `pending-${index}`
        ),
      },
      'OneDrive'
    )
    const syncContext: Record<string, unknown> = {}

    const result = await onedriveConnector.listDocuments(
      'token',
      { maxFiles: '1' },
      cursor,
      syncContext
    )

    expect(result.documents.map((document) => document.externalId)).toEqual(['f1'])
    expect(result.hasMore).toBe(false)
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
    const url = `${GRAPH}/me/drive/root:/My%20Docs/Q1%20%26%20Q2:/children?$top=200&$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`
    const requested = mockGraph({ [url]: { body: { value: [] } } })

    await onedriveConnector.listDocuments(
      'token',
      { folderPath: '/My Docs/Q1 & Q2/' },
      undefined,
      {}
    )

    expect(requested[0]).toBe(url)
  })

  it.each(['1.5', 'Infinity'])(
    'rejects invalid maxFiles %s before calling Graph',
    async (maxFiles) => {
      const requested = mockGraph({})

      await expect(
        onedriveConnector.listDocuments('token', { maxFiles }, undefined, {})
      ).rejects.toThrow(/positive safe integer/)
      expect(requested).toHaveLength(0)
    }
  )
})

describe('onedrive validateConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['1.5', 'Infinity'])(
    'rejects invalid maxFiles %s without calling Graph',
    async (maxFiles) => {
      const requested = mockGraph({})

      await expect(onedriveConnector.validateConfig!('token', { maxFiles })).resolves.toEqual({
        valid: false,
        error: 'Max files must be a positive safe integer, or 0 for unlimited',
      })
      expect(requested).toHaveLength(0)
    }
  )

  it('accepts a valid integer maxFiles', async () => {
    const validateRootUrl = `${GRAPH}/me/drive/root/children?$top=1&$select=id`
    const requested = mockGraph({ [validateRootUrl]: { body: { value: [] } } })

    await expect(onedriveConnector.validateConfig!('token', { maxFiles: '25' })).resolves.toEqual({
      valid: true,
    })
    expect(requested).toEqual([validateRootUrl])
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

  it.each([{}, { id: 'f1', name: 'Missing facet' }, file('different', 'a.txt')])(
    'rejects malformed metadata instead of replacing retained content',
    async (metadata) => {
      mockGraph({
        [`${GRAPH}/me/drive/items/f1?$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`]:
          {
            body: metadata,
          },
      })

      await expect(onedriveConnector.getDocument!('token', {}, 'f1')).rejects.toThrow(
        'Microsoft Graph returned malformed OneDrive item metadata'
      )
    }
  )

  it('authoritatively skips a listed file that changed to a folder', async () => {
    mockGraph({
      [`${GRAPH}/me/drive/items/f1?$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`]:
        {
          body: folder('f1', 'Former document'),
        },
    })

    await expect(onedriveConnector.getDocument!('token', {}, 'f1')).resolves.toMatchObject({
      content: '',
      skippedReason: 'File is no longer an indexable document',
      skippedExistingDisposition: 'replace',
    })
  })

  it('authoritatively skips a listed file that changed to a package', async () => {
    mockGraph({
      [`${GRAPH}/me/drive/items/f1?$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`]:
        {
          body: { id: 'f1', name: 'Former document', package: { type: 'oneNote' } },
        },
    })

    await expect(onedriveConnector.getDocument!('token', {}, 'f1')).resolves.toMatchObject({
      skippedExistingDisposition: 'replace',
      skippedReason: 'File is no longer an indexable document',
    })
  })

  it('produces the same contentHash as the listing stub', async () => {
    const item = file('f1', 'a.txt')
    mockGraph({
      [ROOT_URL]: { body: { value: [item] } },
      [`${GRAPH}/me/drive/items/f1?$select=id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdBy,parentReference`]:
        { body: item },
    })

    const listed = await onedriveConnector.listDocuments('token', {}, undefined, {})

    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (url.endsWith('/content')) {
        return {
          ok: true,
          status: 200,
          body: null,
          headers: new Headers({ 'content-length': '5' }),
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

  it('marks an empty file as an authoritative skip', async () => {
    const item = file('empty', 'empty.txt', 0)
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (url.endsWith('/content')) {
        return {
          ok: true,
          status: 200,
          body: null,
          headers: new Headers({ 'content-length': '0' }),
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => item,
        text: async () => '',
      } as unknown as Response
    })

    const document = await onedriveConnector.getDocument!('token', {}, 'empty')

    expect(document).toMatchObject({
      externalId: 'empty',
      content: '',
      contentDeferred: false,
      skippedReason: 'Document contains no extractable text',
      skippedExistingDisposition: 'replace',
    })
  })
})

describe('onedrive listing scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([403, 404])(
    'reads a %s on the configured folder as a scope the caller cannot reach',
    async (status) => {
      mockGraph({ [ROOT_URL]: { status, body: {} } })

      const error = await onedriveConnector.listDocuments('token', {}).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(Error)
      expect(onedriveConnector.isListingScopeUnavailableError!(error)).toBe(true)
    }
  )

  it('keeps any other listing failure retryable', async () => {
    mockGraph({ [ROOT_URL]: { status: 500, body: {} } })

    const error = await onedriveConnector.listDocuments('token', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(onedriveConnector.isListingScopeUnavailableError!(error)).toBe(false)
  })
})
