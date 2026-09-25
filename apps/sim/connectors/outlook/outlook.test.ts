import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isCurrentMessage,
  outlookConnector,
  parseFolderCollection,
} from '@/connectors/outlook/outlook'

const DELETED_ITEMS_ID = 'deleted-items-id'
const DELETED_SUBFOLDER_ID = 'deleted-subfolder-id'
const INBOX_ID = 'inbox-id'
const JUNK_EMAIL_ID = 'junk-email-id'

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

describe('isCurrentMessage', () => {
  const excluded: ReadonlySet<string> = new Set([DELETED_ITEMS_ID, DELETED_SUBFOLDER_ID])

  it('excludes messages in Deleted Items and its subfolders', () => {
    expect(isCurrentMessage({ parentFolderId: DELETED_ITEMS_ID }, excluded)).toBe(false)
    expect(isCurrentMessage({ parentFolderId: DELETED_SUBFOLDER_ID }, excluded)).toBe(false)
  })

  it('fails open when parentFolderId is missing', () => {
    expect(isCurrentMessage({}, excluded)).toBe(true)
    expect(isCurrentMessage({ parentFolderId: undefined }, excluded)).toBe(true)
    expect(isCurrentMessage({ parentFolderId: '' }, excluded)).toBe(true)
  })

  it('matches folder ids exactly, not by prefix', () => {
    expect(isCurrentMessage({ parentFolderId: `${DELETED_ITEMS_ID}-2` }, excluded)).toBe(true)
  })
})

describe('parseFolderCollection', () => {
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

  it('keeps junk mail, which is a spam classification rather than a deletion', async () => {
    routeFetch([
      deletedItemsRoute,
      childFoldersRoute,
      [
        /\/me\/messages\?/,
        () =>
          jsonResponse({
            value: [
              message({ id: 'm1', conversationId: 'live', parentFolderId: INBOX_ID }),
              message({ id: 'm2', conversationId: 'junked', parentFolderId: JUNK_EMAIL_ID }),
            ],
          }),
      ],
    ])

    const result = await outlookConnector.listDocuments('token', { folder: 'all' }, undefined, {})

    expect(result.documents.map((d) => d.externalId).sort()).toEqual(['junked', 'live'])
    const requested = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => url.includes('junkemail'))).toBe(false)
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
})

describe('listDocuments conversation cap', () => {
  function inboxMessagesRoute(count: number): [RegExp, () => Response] {
    return [
      /\/me\/mailFolders\/inbox\/messages\?/,
      () =>
        jsonResponse({
          value: Array.from({ length: count }, (_, index) =>
            message({ id: `m${index}`, conversationId: `conv-${index}`, parentFolderId: INBOX_ID })
          ),
        }),
    ]
  }

  it('caps the listing at maxConversations and flags it capped', async () => {
    routeFetch([inboxMessagesRoute(3)])

    const syncContext: Record<string, unknown> = {}
    const result = await outlookConnector.listDocuments(
      'token',
      { folder: 'inbox', maxConversations: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('reads a folder Graph cannot find as a scope the caller cannot reach', async () => {
    routeFetch([[/\/me\/mailFolders\/.*\/messages\?/, () => jsonResponse({}, { status: 404 })]])

    const error = await outlookConnector
      .listDocuments('token', { folder: 'missing-folder-id' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(outlookConnector.isListingScopeUnavailableError!(error)).toBe(true)
  })

  it('keeps any other listing failure retryable', async () => {
    routeFetch([[/\/me\/mailFolders\/inbox\/messages\?/, () => jsonResponse({}, { status: 500 })]])

    const error = await outlookConnector
      .listDocuments('token', { folder: 'inbox' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(outlookConnector.isListingScopeUnavailableError!(error)).toBe(false)
  })
})
