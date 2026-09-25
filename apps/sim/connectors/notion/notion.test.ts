import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry, mockReadBoundedHttpErrorPayload } = vi.hoisted(() => ({
  mockFetchWithRetry: vi.fn(),
  mockReadBoundedHttpErrorPayload: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  readBoundedHttpErrorPayload: mockReadBoundedHttpErrorPayload,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  fetchWithRetry: mockFetchWithRetry,
}))
vi.mock('@/components/icons', () => ({ NotionIcon: () => null }))

import { notionConnector } from '@/connectors/notion/notion'

function notionResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function page(id = 'page-1') {
  return {
    object: 'page',
    id,
    in_trash: false,
    url: `https://www.notion.so/${id}`,
    created_time: '2026-08-01T00:00:00.000Z',
    last_edited_time: '2026-08-02T00:00:00.000Z',
    parent: { type: 'workspace', workspace: true },
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: 'Test page' }],
      },
    },
  }
}

function dataSources(prefix: string, count: number): { id: string; name: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} ${index + 1}`,
  }))
}

function dataSourceCursor(value: Record<string, unknown>): string {
  return `notion-data-sources:v1:${encodeURIComponent(JSON.stringify(value))}`
}

beforeEach(() => {
  mockReadBoundedHttpErrorPayload.mockReset()
  mockReadBoundedHttpErrorPayload.mockImplementation(async (response: Response) => ({
    ok: true,
    body: await response.text(),
  }))
})

describe('notion markdown hydration', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('rejects oversized successful page metadata before parsing JSON', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      new Response(`{"padding":"${'x'.repeat(1024 * 1024)}"}`, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(notionConnector.getDocument('token', {}, 'page-1')).rejects.toThrow(
      'Notion page page-1 metadata exceeds the 1048576 byte limit'
    )
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
  })

  it('marks inaccessible recovery blocks retryable instead of stabilizing partial markdown', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({
          markdown: 'Available content',
          truncated: true,
          unknown_block_ids: ['inaccessible-1'],
        })
      )
      .mockResolvedValueOnce(
        notionResponse(
          {
            object: 'error',
            code: 'object_not_found',
            message: 'Block is inaccessible',
            request_id: 'request-inaccessible-1',
          },
          404
        )
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document).toMatchObject({
      content: '',
      contentDeferred: false,
      contentHash: 'notion:v3:page-1:2026-08-02T00:00:00.000Z',
      skippedRetryContentHash: 'notion:retry:v1:page-1',
      skippedReason:
        'Notion page contains blocks the connection cannot access and was not indexed completely',
    })
    expect(document?.skippedExistingDisposition).toBeUndefined()
  })

  it('marks an unrecoverable truncated response as skipped rather than storing partial content', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({ markdown: 'Partial', truncated: true, unknown_block_ids: [] })
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.contentDeferred).toBe(false)
    expect(document?.skippedReason).toContain('truncated markdown without recovery block IDs')
  })

  it('bounds aggregate markdown recovery requests across nested unknown blocks', async () => {
    const firstHundredIds = Array.from({ length: 100 }, (_, index) => `nested-${index + 1}`)
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({ markdown: 'Root', truncated: true, unknown_block_ids: firstHundredIds })
      )
      .mockImplementation((url: string) => {
        if (url.includes('/pages/nested-1/markdown')) {
          return Promise.resolve(
            notionResponse({
              markdown: 'Nested 1',
              truncated: true,
              unknown_block_ids: ['nested-101'],
            })
          )
        }
        if (url.includes('/pages/')) {
          return Promise.resolve(
            notionResponse(
              {
                object: 'error',
                code: 'validation_error',
                message: 'Unsupported markdown block type',
                request_id: 'request-unsupported',
              },
              400
            )
          )
        }
        return Promise.resolve(
          notionResponse({ object: 'block', type: 'bookmark', bookmark: { url } })
        )
      })

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.contentDeferred).toBe(false)
    expect(document?.skippedReason).toContain('more than 200 markdown recovery requests')
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(202)
  })

  it('bounds aggregate unique recovery IDs before the pending queue can fan out', async () => {
    const ids = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => `nested-${start + index}`)
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({ markdown: 'Root', truncated: true, unknown_block_ids: ids(1, 100) })
      )
      .mockResolvedValueOnce(
        notionResponse({ markdown: 'Nested 1', truncated: true, unknown_block_ids: ids(101, 100) })
      )
      .mockResolvedValueOnce(
        notionResponse({ markdown: 'Nested 2', truncated: true, unknown_block_ids: ['nested-201'] })
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.contentDeferred).toBe(false)
    expect(document?.skippedReason).toContain('more than 200 unique markdown recovery IDs')
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4)
  })

  it('propagates an ambiguous metadata 404 so hydration is retried', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse(
        {
          object: 'error',
          code: 'object_not_found',
          message: 'Page not found or integration access was removed',
          request_id: 'request-page-1',
        },
        404
      )
    )

    await expect(notionConnector.getDocument('token', {}, 'page-1')).rejects.toThrow(
      'Failed to get Notion page: 404, code=object_not_found'
    )
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
  })
})

describe('notion listing completeness', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('does not mark an exactly exhausted workspace listing as capped', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({
        results: [page('page-1'), page('page-2')],
        has_more: false,
        next_cursor: null,
      })
    )
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { maxPages: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(result.reconciliationSafe).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('marks the listing capped when the same limit hides another workspace page', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({
        results: [page('page-1'), page('page-2')],
        has_more: true,
        next_cursor: 'cursor-2',
      })
    )
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { maxPages: '2' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it.each([undefined, null, '', '   '])(
    'stops safely when a data source has more rows without a usable cursor: %j',
    async (nextCursor) => {
      mockFetchWithRetry
        .mockResolvedValueOnce(
          notionResponse({
            object: 'database',
            id: 'database-1',
            data_sources: [
              { id: 'source-1', name: 'Primary' },
              { id: 'source-2', name: 'Archive' },
            ],
          })
        )
        .mockResolvedValueOnce(
          notionResponse({
            results: [page('page-1')],
            has_more: true,
            next_cursor: nextCursor,
          })
        )

      const syncContext: Record<string, unknown> = {}
      const result = await notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: 'database-1' },
        undefined,
        syncContext
      )

      expect(result.documents.map((document) => document.externalId)).toEqual(['page-1'])
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeUndefined()
      expect(result.reconciliationSafe).toBe(false)
      expect(syncContext.listingCapped).toBe(true)
      expect(syncContext.reconciliationUnsafe).toBe(true)
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
      expect(
        mockFetchWithRetry.mock.calls.some(([url]) => String(url).includes('/source-2/query'))
      ).toBe(false)
    }
  )

  it('makes a data-source listing non-authoritative when Notion reports its 10,000-row ceiling', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({
          object: 'database',
          id: 'database-1',
          data_sources: [{ id: 'source-1', name: 'Primary' }],
        })
      )
      .mockResolvedValueOnce(
        notionResponse({
          results: [page('page-10000')],
          has_more: false,
          next_cursor: null,
          request_status: {
            type: 'incomplete',
            incomplete_reason: 'query_result_limit_reached',
          },
        })
      )
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: 'database-1' },
      undefined,
      syncContext
    )

    expect(result.documents.map((document) => document.externalId)).toEqual(['page-10000'])
    expect(result.hasMore).toBe(false)
    expect(result.reconciliationSafe).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.reconciliationUnsafe).toBe(true)
  })

  it('bounds configured database IDs before validation fans out', async () => {
    const databaseIds = Array.from({ length: 101 }, (_, index) => `database-${index + 1}`)

    await expect(
      notionConnector.validateConfig('token', {
        scope: 'database',
        databaseId: databaseIds,
      })
    ).resolves.toEqual({
      valid: false,
      error: 'Notion connector supports at most 100 databases',
    })
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })

  it('rejects a database with too many data sources before caching them', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({ data_sources: dataSources('source', 101) })
    )
    const syncContext: Record<string, unknown> = {}

    await expect(
      notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: 'database-1' },
        undefined,
        syncContext
      )
    ).rejects.toThrow('exposes more than 100 data sources')
    expect(syncContext.notionResolvedDataSources).toBeUndefined()
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps a bare provider cursor compatible for a single resolved data source', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({ data_sources: [{ id: 'source-1', name: 'Primary' }] })
      )
      .mockResolvedValueOnce(
        notionResponse({ results: [page('page-1')], has_more: false, next_cursor: null })
      )

    await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: 'database-1' },
      'legacy-provider-cursor'
    )

    const queryBody = JSON.parse(
      String((mockFetchWithRetry.mock.calls[1][1] as RequestInit).body)
    ) as Record<string, unknown>
    expect(queryBody.start_cursor).toBe('legacy-provider-cursor')
  })

  it('resumes a production legacy database cursor at the first current data source for that database', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({
          data_sources: [{ id: 'database-1-source-1' }, { id: 'database-1-source-2' }],
        })
      )
      .mockResolvedValueOnce(notionResponse({ data_sources: [{ id: 'database-2-source-1' }] }))
      .mockResolvedValueOnce(
        notionResponse({ results: [page('page-2')], has_more: false, next_cursor: null })
      )

    const result = await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: ['database-1', 'database-2'] },
      JSON.stringify({ databaseIndex: 1, cursor: 'legacy-provider-cursor' })
    )

    expect(result.documents.map((document) => document.externalId)).toEqual(['page-2'])
    expect(String(mockFetchWithRetry.mock.calls[2][0])).toBe(
      'https://api.notion.com/v1/data_sources/database-2-source-1/query'
    )
    const queryBody = JSON.parse(
      String((mockFetchWithRetry.mock.calls[2][1] as RequestInit).body)
    ) as Record<string, unknown>
    expect(queryBody.start_cursor).toBe('legacy-provider-cursor')
  })

  it('rejects an out-of-bounds compound data-source cursor', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({ data_sources: [{ id: 'source-1', name: 'Primary' }] })
    )

    await expect(
      notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: 'database-1' },
        dataSourceCursor({ sourceIndex: 3 })
      )
    ).rejects.toThrow('Invalid Notion connector data-source cursor')
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
  })

  it('does not over-fetch child pages past maxPages and marks the hidden page', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({
          results: [
            { id: 'child-1', type: 'child_page' },
            { id: 'child-2', type: 'child_page' },
          ],
          has_more: false,
          next_cursor: null,
        })
      )
      .mockResolvedValueOnce(notionResponse(page('root-page')))
      .mockResolvedValueOnce(notionResponse(page('child-1')))
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { scope: 'page', rootPageId: 'root-page', maxPages: '2' },
      undefined,
      syncContext
    )

    expect(result.documents.map((document) => document.externalId)).toEqual([
      'root-page',
      'child-1',
    ])
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(3)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('makes a parent-page listing non-authoritative when live metadata is omitted by error', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({
          results: [
            { id: 'child-1', type: 'child_page' },
            { id: 'child-2', type: 'child_page' },
          ],
          has_more: false,
          next_cursor: null,
        })
      )
      .mockResolvedValueOnce(notionResponse(page('root-page')))
      .mockResolvedValueOnce(
        notionResponse(
          {
            object: 'error',
            code: 'internal_server_error',
            message: 'Temporary provider failure',
            request_id: 'request-child-1',
          },
          503
        )
      )
      .mockResolvedValueOnce(notionResponse(page('child-2')))
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { scope: 'page', rootPageId: 'root-page' },
      undefined,
      syncContext
    )

    expect(result.documents.map((document) => document.externalId)).toEqual([
      'root-page',
      'child-2',
    ])
    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.reconciliationUnsafe).toBe(true)
  })

  it('makes reconciliation unsafe when listed child metadata returns an ambiguous 404', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({
          results: [{ id: 'child-1', type: 'child_page' }],
          has_more: false,
          next_cursor: null,
        })
      )
      .mockResolvedValueOnce(notionResponse(page('root-page')))
      .mockResolvedValueOnce(
        notionResponse(
          {
            object: 'error',
            code: 'object_not_found',
            message: 'Page not found',
            request_id: 'request-child-1',
          },
          404
        )
      )
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { scope: 'page', rootPageId: 'root-page' },
      undefined,
      syncContext
    )

    expect(result.documents.map((document) => document.externalId)).toEqual(['root-page'])
    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.reconciliationUnsafe).toBe(true)
  })
})
