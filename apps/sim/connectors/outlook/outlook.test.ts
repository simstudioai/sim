/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DELETED_ITEMS_FOLDER,
  isAllMailSync,
  isCurrentMessage,
  outlookConnector,
  parseFolderCollection,
  resolveFolder,
} from '@/connectors/outlook/outlook'

const DELETED_ITEMS_ID = 'deleted-items-id'
const DELETED_SUBFOLDER_ID = 'deleted-subfolder-id'
const INBOX_ID = 'inbox-id'

interface JsonResponseInit {
  status?: number
}

function jsonResponse(body: unknown, init: JsonResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Minimal Graph message payload, defaulting to fields the connector requires
 * to build a conversation stub.
 */
function message(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    subject: 'Hello',
    receivedDateTime: '2026-01-01T00:00:00Z',
    inferenceClassification: 'focused',
    webLink: 'https://outlook.office.com/mail/id/msg-1',
    ...overrides,
  }
}

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Routes Graph requests by URL so tests only declare the responses they care
 * about. Unmatched URLs fail loudly rather than silently returning empty data.
 */
function routeFetch(routes: Array<[RegExp, () => Response]>) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    for (const [pattern, respond] of routes) {
      if (pattern.test(url)) return respond()
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

const deletedItemsRoute: [RegExp, () => Response] = [
  /mailFolders\/deleteditems\?/,
  () => jsonResponse({ id: DELETED_ITEMS_ID, childFolderCount: 1 }),
]

const childFoldersRoute: [RegExp, () => Response] = [
  /childFolders/,
  () => jsonResponse({ value: [{ id: DELETED_SUBFOLDER_ID, childFolderCount: 0 }] }),
]

describe('resolveFolder', () => {
  it('defaults to the inbox when unset', () => {
    expect(resolveFolder({})).toBe('inbox')
  })

  it('defaults to the inbox for empty or non-string values', () => {
    expect(resolveFolder({ folder: '' })).toBe('inbox')
    expect(resolveFolder({ folder: '   ' })).toBe('inbox')
    expect(resolveFolder({ folder: 42 })).toBe('inbox')
  })

  it('returns the trimmed folder', () => {
    expect(resolveFolder({ folder: 'sentitems' })).toBe('sentitems')
    expect(resolveFolder({ folder: '  archive  ' })).toBe('archive')
    expect(resolveFolder({ folder: 'all' })).toBe('all')
  })
})

describe('isAllMailSync', () => {
  it('is true only for the mailbox-wide option', () => {
    expect(isAllMailSync({ folder: 'all' })).toBe(true)
    expect(isAllMailSync({ folder: ' all ' })).toBe(true)
  })

  it('is false for folder-scoped syncs', () => {
    expect(isAllMailSync({})).toBe(false)
    expect(isAllMailSync({ folder: 'inbox' })).toBe(false)
    expect(isAllMailSync({ folder: 'deleteditems' })).toBe(false)
  })
})

describe('DELETED_ITEMS_FOLDER', () => {
  it('excludes Deleted Items only, never Junk Email', () => {
    expect(DELETED_ITEMS_FOLDER).toBe('deleteditems')
  })
})

describe('isCurrentMessage', () => {
  const excluded: ReadonlySet<string> = new Set([DELETED_ITEMS_ID, DELETED_SUBFOLDER_ID])

  it('keeps messages in non-excluded folders', () => {
    expect(isCurrentMessage({ parentFolderId: INBOX_ID }, excluded)).toBe(true)
  })

  it('excludes messages in Deleted Items and its subfolders', () => {
    expect(isCurrentMessage({ parentFolderId: DELETED_ITEMS_ID }, excluded)).toBe(false)
    expect(isCurrentMessage({ parentFolderId: DELETED_SUBFOLDER_ID }, excluded)).toBe(false)
  })

  it('fails open when parentFolderId is missing', () => {
    expect(isCurrentMessage({}, excluded)).toBe(true)
    expect(isCurrentMessage({ parentFolderId: undefined }, excluded)).toBe(true)
    expect(isCurrentMessage({ parentFolderId: '' }, excluded)).toBe(true)
  })

  it('fails open when no exclusions could be resolved', () => {
    const none: ReadonlySet<string> = new Set()
    expect(isCurrentMessage({ parentFolderId: DELETED_ITEMS_ID }, none)).toBe(true)
  })

  it('matches folder ids exactly, not by prefix', () => {
    expect(isCurrentMessage({ parentFolderId: `${DELETED_ITEMS_ID}-2` }, excluded)).toBe(true)
  })
})

describe('parseFolderCollection', () => {
  it('extracts folder ids and the continuation link', () => {
    expect(
      parseFolderCollection({
        value: [{ id: 'a', childFolderCount: 2 }, { id: 'b' }],
        '@odata.nextLink': 'https://graph.microsoft.com/next',
      })
    ).toEqual({
      folders: [
        { id: 'a', childFolderCount: 2 },
        { id: 'b', childFolderCount: 0 },
      ],
      nextLink: 'https://graph.microsoft.com/next',
    })
  })

  it('yields no folders for malformed payloads', () => {
    expect(parseFolderCollection(null).folders).toEqual([])
    expect(parseFolderCollection('nope').folders).toEqual([])
    expect(parseFolderCollection({ value: 'nope' }).folders).toEqual([])
    expect(parseFolderCollection({ value: [null, 42, { id: '' }, { id: 7 }] }).folders).toEqual([])
    expect(parseFolderCollection({ value: [], '@odata.nextLink': 5 }).nextLink).toBeUndefined()
  })
})

describe('listDocuments folder exclusion', () => {
  it('drops conversations whose messages sit in Deleted Items or a subfolder', async () => {
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      [
        /\/me\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({ id: 'm1', conversationId: 'live', parentFolderId: INBOX_ID }),
              message({ id: 'm2', conversationId: 'trashed', parentFolderId: DELETED_ITEMS_ID }),
              message({ id: 'm3', conversationId: 'nested', parentFolderId: DELETED_SUBFOLDER_ID }),
            ],
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await outlookConnector.listDocuments(
      'token',
      { folder: 'all' },
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['live'])
  })

  it('keeps every conversation when the Deleted Items lookup fails with a non-2xx', async () => {
    routeFetch([
      [/mailFolders\/deleteditems\?/, () => jsonResponse({ error: 'forbidden' }, { status: 403 })],
      [
        /\/me\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({ id: 'm1', conversationId: 'live', parentFolderId: INBOX_ID }),
              message({ id: 'm2', conversationId: 'trashed', parentFolderId: DELETED_ITEMS_ID }),
            ],
          }),
      ],
    ])

    const result = await outlookConnector.listDocuments('token', { folder: 'all' }, undefined, {})

    expect(result.documents.map((d) => d.externalId).sort()).toEqual(['live', 'trashed'])
  })

  it('keeps every conversation when the Deleted Items lookup throws', async () => {
    routeFetch([
      [
        /mailFolders\/deleteditems\?/,
        () => {
          throw new Error('graph exploded')
        },
      ],
      [
        /\/me\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({ id: 'm2', conversationId: 'trashed', parentFolderId: DELETED_ITEMS_ID }),
            ],
          }),
      ],
    ])

    const result = await outlookConnector.listDocuments('token', { folder: 'all' }, undefined, {})

    expect(result.documents.map((d) => d.externalId)).toEqual(['trashed'])
  })

  it('keeps Deleted Items messages when the subfolder walk fails partway', async () => {
    routeFetch([
      deletedItemsRoute,
      [/childFolders/, () => jsonResponse({ error: 'boom' }, { status: 403 })],
      [
        /\/me\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({ id: 'm3', conversationId: 'nested', parentFolderId: DELETED_SUBFOLDER_ID }),
              message({ id: 'm2', conversationId: 'trashed', parentFolderId: DELETED_ITEMS_ID }),
            ],
          }),
      ],
    ])

    const result = await outlookConnector.listDocuments('token', { folder: 'all' }, undefined, {})

    expect(result.documents.map((d) => d.externalId)).toEqual(['nested'])
  })

  it('never resolves folders for a folder-scoped sync', async () => {
    routeFetch([
      [
        /mailFolders\/inbox\/messages\?/,
        () =>
          jsonResponse({
            value: [message({ id: 'm1', conversationId: 'live', parentFolderId: INBOX_ID })],
          }),
      ],
    ])

    const result = await outlookConnector.listDocuments('token', { folder: 'inbox' }, undefined, {})

    expect(result.documents.map((d) => d.externalId)).toEqual(['live'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses one folder walk across pages of the same sync run', async () => {
    let page = 0
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      [
        /\/me\/messages/,
        () => {
          page++
          return page === 1
            ? jsonResponse({
                value: [message({ id: 'm1', conversationId: 'live', parentFolderId: INBOX_ID })],
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?page=2',
              })
            : jsonResponse({
                value: [message({ id: 'm4', conversationId: 'live2', parentFolderId: INBOX_ID })],
              })
        },
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await outlookConnector.listDocuments(
      'token',
      { folder: 'all' },
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)

    const second = await outlookConnector.listDocuments(
      'token',
      { folder: 'all' },
      first.nextCursor,
      syncContext
    )

    expect(second.documents.map((d) => d.externalId).sort()).toEqual(['live', 'live2'])
    const folderCalls = fetchMock.mock.calls.filter(([input]) => /mailFolders/.test(String(input)))
    expect(folderCalls).toHaveLength(2)
  })

  it('paginates on the raw page length, not the post-exclusion count', async () => {
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      [
        /\/me\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({ id: 'm2', conversationId: 'trashed', parentFolderId: DELETED_ITEMS_ID }),
            ],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?page=2',
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await outlookConnector.listDocuments(
      'token',
      { folder: 'all' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(true)
    expect(result.documents).toEqual([])
    expect(syncContext._totalMessagesFetched).toBe(1)
  })
})

describe('getDocument folder exclusion', () => {
  const conversationRoute = (parentFolderIds: string[]): [RegExp, () => Response] => [
    /\/me\/messages\?/,
    () =>
      jsonResponse({
        value: parentFolderIds.map((parentFolderId, index) =>
          message({
            id: `msg-${index}`,
            conversationId: 'conv-1',
            parentFolderId,
            receivedDateTime: `2026-01-0${index + 1}T00:00:00Z`,
            body: { contentType: 'text', content: `body ${index}` },
          })
        ),
      }),
  ]

  it('excludes deleted messages from the content and contentHash', async () => {
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      conversationRoute([INBOX_ID, DELETED_ITEMS_ID]),
    ])

    const doc = await outlookConnector.getDocument('token', { folder: 'all' }, 'conv-1', {})

    expect(doc?.content).toContain('body 0')
    expect(doc?.content).not.toContain('body 1')
    expect(doc?.contentHash).toBe('outlook:conv-1:2026-01-01T00:00:00Z')
  })

  it('returns null when every message in the conversation is deleted', async () => {
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      conversationRoute([DELETED_ITEMS_ID, DELETED_SUBFOLDER_ID]),
    ])

    expect(await outlookConnector.getDocument('token', { folder: 'all' }, 'conv-1', {})).toBeNull()
  })

  it('fails open and keeps every message when folder resolution fails', async () => {
    routeFetch([
      [/mailFolders\/deleteditems\?/, () => jsonResponse({ error: 'nope' }, { status: 403 })],
      conversationRoute([INBOX_ID, DELETED_ITEMS_ID]),
    ])

    const doc = await outlookConnector.getDocument('token', { folder: 'all' }, 'conv-1', {})

    expect(doc?.content).toContain('body 0')
    expect(doc?.content).toContain('body 1')
    expect(doc?.contentHash).toBe('outlook:conv-1:2026-01-02T00:00:00Z')
  })

  it('does not resolve folders for a folder-scoped sync', async () => {
    routeFetch([
      [
        /mailFolders\/inbox\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({
                id: 'msg-0',
                conversationId: 'conv-1',
                parentFolderId: INBOX_ID,
                body: { contentType: 'text', content: 'body 0' },
              }),
            ],
          }),
      ],
    ])

    const doc = await outlookConnector.getDocument('token', { folder: 'inbox' }, 'conv-1', {})

    expect(doc?.content).toContain('body 0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares the resolved folder set across concurrent getDocument calls', async () => {
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      conversationRoute([INBOX_ID, DELETED_ITEMS_ID]),
    ])

    const syncContext: Record<string, unknown> = {}
    await Promise.all([
      outlookConnector.getDocument('token', { folder: 'all' }, 'conv-1', syncContext),
      outlookConnector.getDocument('token', { folder: 'all' }, 'conv-2', syncContext),
      outlookConnector.getDocument('token', { folder: 'all' }, 'conv-3', syncContext),
    ])

    const folderCalls = fetchMock.mock.calls.filter(([input]) => /mailFolders/.test(String(input)))
    expect(folderCalls).toHaveLength(2)
  })
})
