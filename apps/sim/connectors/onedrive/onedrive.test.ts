import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { onedriveConnector } from '@/connectors/onedrive/onedrive'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const mockFetchWithRetry = knowledgeSecureFetchMockFns.mockFetchWithRetry

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
  it.each([
    { value: [{ id: 'f1', name: 'Missing facet' }] },
    { value: [], '@odata.nextLink': 'https://evil.example/items' },
  ])('rejects ambiguous or unsafe list metadata', async (body) => {
    mockGraph({ [ROOT_URL]: { body } })

    await expect(onedriveConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow()
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
})

describe('onedrive getDocument', () => {
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
})

describe('onedrive listing scope', () => {
  it.each([403, 404])(
    'reads a %s on the configured folder as a scope the caller cannot reach',
    async (status) => {
      mockGraph({ [ROOT_URL]: { status, body: {} } })

      const error = await onedriveConnector.listDocuments('token', {}).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(Error)
      expect(onedriveConnector.isListingScopeUnavailableError!(error)).toBe(true)
    }
  )

  it('skips a subfolder the member cannot reach and keeps their listing complete', async () => {
    mockGraph({
      [ROOT_URL]: {
        body: { value: [file('f1', 'a.txt'), folder('open', 'open'), folder('locked', 'locked')] },
      },
      [childrenUrl('locked')]: { status: 403, body: {} },
      [childrenUrl('open')]: { body: { value: [file('f2', 'b.md')] } },
    })
    const syncContext: Record<string, unknown> = { ...PER_MEMBER_LISTING_CONTEXT }

    const result = await onedriveConnector.listDocuments('token', {}, undefined, syncContext)

    expect(result.documents.map((d) => d.externalId)).toEqual(['f1', 'f2'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('still fails a shared listing on a subfolder it cannot reach', async () => {
    mockGraph({
      [ROOT_URL]: { body: { value: [file('f1', 'a.txt'), folder('locked', 'locked')] } },
    })

    const error = await onedriveConnector
      .listDocuments('token', {}, undefined, {})
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(onedriveConnector.isListingScopeUnavailableError!(error)).toBe(true)
  })
})
