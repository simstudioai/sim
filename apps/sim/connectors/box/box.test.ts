/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ BoxCompanyIcon: () => null }))

import { boxConnector } from '@/connectors/box/box'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

interface FolderReply {
  status?: number
  entries?: unknown[]
}

/** Routes `GET /folders/:id/items` by folder id; unknown folders answer 404. */
function mockFolders(folders: Record<string, FolderReply>) {
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    const folderId = /\/folders\/([^/]+)\/items/.exec(url)?.[1] ?? ''
    const reply = folders[folderId] ?? { status: 404 }
    const status = reply.status ?? 200
    const body = { entries: reply.entries ?? [], next_marker: null }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  })
}

const FILE = { type: 'file', id: 'f1', name: 'notes.txt', extension: 'txt', size: 10 }
const SUBFOLDER = { type: 'folder', id: 'sub', name: 'Private' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('box listDocuments with a subfolder the caller cannot reach', () => {
  it('caps the listing under a shared credential so nothing is reconciled as deleted', async () => {
    mockFolders({ '0': { entries: [FILE, SUBFOLDER] }, sub: { status: 403 } })
    const syncContext: Record<string, unknown> = {}

    const result = await boxConnector.listDocuments('token', {}, undefined, syncContext)

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['f1'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it("lists completely under a member's own token so their access to it is withdrawn", async () => {
    mockFolders({ '0': { entries: [FILE, SUBFOLDER] }, sub: { status: 403 } })
    const syncContext: Record<string, unknown> = { ...PER_MEMBER_LISTING_CONTEXT }

    const result = await boxConnector.listDocuments('token', {}, undefined, syncContext)

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['f1'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('reports the configured root being unreachable as the scope being unavailable', async () => {
    mockFolders({ '42': { status: 403 } })
    const syncContext: Record<string, unknown> = { ...PER_MEMBER_LISTING_CONTEXT }

    const error = await boxConnector
      .listDocuments('token', { folderId: '42' }, undefined, syncContext)
      .catch((caught: unknown) => caught)

    expect(boxConnector.isListingScopeUnavailableError?.(error)).toBe(true)
  })
})
