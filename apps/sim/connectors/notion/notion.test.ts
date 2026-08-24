/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  readBoundedHttpErrorBody: async (response: Response) => JSON.stringify(await response.json()),
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ NotionIcon: () => null }))

import { notionConnector } from '@/connectors/notion/notion'
import { CONNECTOR_MAX_FILE_BYTES } from '@/connectors/utils'

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

describe('notion markdown hydration', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('uses the current API version and retrieves complete page markdown in one request', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(notionResponse(page())).mockResolvedValueOnce(
      notionResponse({
        markdown: '# Overview\n\nNested tab content',
        truncated: false,
        unknown_block_ids: [],
      })
    )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.content).toContain('Overview')
    expect(document?.content).toContain('Nested tab content')
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
    expect(mockFetchWithRetry.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.notion.com/v1/pages/page-1',
      'https://api.notion.com/v1/pages/page-1/markdown',
    ])

    for (const [, options] of mockFetchWithRetry.mock.calls) {
      expect(((options as RequestInit).headers as Record<string, string>)['Notion-Version']).toBe(
        '2026-03-11'
      )
    }
  })

  it.each([
    [{ markdown: 'Partial', truncated: true, unknown_block_ids: [] }, 'truncated=true'],
    [
      { markdown: 'Partial', truncated: false, unknown_block_ids: ['unknown-1'] },
      'unknownBlocks=1',
    ],
  ])(
    'rejects incomplete markdown so it cannot become a stable-hash success',
    async (body, reason) => {
      mockFetchWithRetry
        .mockResolvedValueOnce(notionResponse(page()))
        .mockResolvedValueOnce(notionResponse(body))

      await expect(notionConnector.getDocument('token', {}, 'page-1')).rejects.toThrow(reason)
    }
  )

  it('propagates redacted structured diagnostics from the markdown endpoint', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(notionResponse(page())).mockResolvedValueOnce(
      notionResponse(
        {
          object: 'error',
          code: 'validation_error',
          message: 'The start_cursor provided is invalid. Authorization: Bearer production-secret',
          request_id: 'request-2',
        },
        400
      )
    )

    await expect(notionConnector.getDocument('token', {}, 'page-1')).rejects.toThrow(
      'Failed to fetch markdown for page-1: 400, code=validation_error, message=The start_cursor provided is invalid. Authorization: Bearer [REDACTED], requestId=request-2'
    )
  })

  it('records an oversized markdown response as an intrinsic skipped document', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(notionResponse(page())).mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(CONNECTOR_MAX_FILE_BYTES + 1) },
      })
    )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.contentDeferred).toBe(false)
    expect(document?.skippedReason).toContain('100MB size limit')
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

  it('discovers and queries every current data source for a configured database ID', async () => {
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
        notionResponse({ results: [page('page-1')], has_more: false, next_cursor: null })
      )

    const syncContext: Record<string, unknown> = {}
    const first = await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: 'database-1' },
      undefined,
      syncContext
    )

    expect(first.documents.map((document) => document.externalId)).toEqual(['page-1'])
    expect(first.nextCursor).toBe(JSON.stringify({ sourceIndex: 1 }))
    expect(first.hasMore).toBe(true)
    expect(String(mockFetchWithRetry.mock.calls[1][0])).toBe(
      'https://api.notion.com/v1/data_sources/source-1/query'
    )

    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({ results: [page('page-2')], has_more: false, next_cursor: null })
    )

    const second = await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: 'database-1' },
      first.nextCursor,
      syncContext
    )

    expect(second.documents.map((document) => document.externalId)).toEqual(['page-2'])
    expect(second.hasMore).toBe(false)
    expect(String(mockFetchWithRetry.mock.calls[2][0])).toBe(
      'https://api.notion.com/v1/data_sources/source-2/query'
    )
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(3)
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

  it('bounds each successful database metadata response before JSON parsing', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(1024 * 1024 + 1) },
      })
    )
    const syncContext: Record<string, unknown> = {}

    await expect(
      notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: 'database-1' },
        undefined,
        syncContext
      )
    ).rejects.toThrow('metadata exceeds the 1048576 byte limit')
    expect(syncContext.notionResolvedDataSources).toBeUndefined()
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
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

  it('bounds total resolved data sources without storing a partial cache', async () => {
    const databaseIds = Array.from({ length: 6 }, (_, index) => `database-${index + 1}`)
    for (const databaseId of databaseIds) {
      mockFetchWithRetry.mockResolvedValueOnce(
        notionResponse({ data_sources: dataSources(`${databaseId}-source`, 100) })
      )
    }
    const syncContext: Record<string, unknown> = {}

    await expect(
      notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: databaseIds },
        undefined,
        syncContext
      )
    ).rejects.toThrow('supports at most 500 data sources')
    expect(syncContext.notionResolvedDataSources).toBeUndefined()
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(6)
  })

  it('does not trust an overbound retained data-source cache', async () => {
    const syncContext: Record<string, unknown> = {
      notionResolvedDataSources: {
        databaseIds: ['database-1'],
        dataSources: Array.from({ length: 501 }, (_, index) => ({
          databaseId: 'database-1',
          dataSourceId: `cached-source-${index + 1}`,
        })),
      },
    }
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse({ data_sources: [{ id: 'source-1' }] }))
      .mockResolvedValueOnce(notionResponse({ results: [], has_more: false, next_cursor: null }))

    await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: 'database-1' },
      undefined,
      syncContext
    )

    expect(String(mockFetchWithRetry.mock.calls[0][0])).toBe(
      'https://api.notion.com/v1/databases/database-1'
    )
    expect(syncContext.notionResolvedDataSources).toEqual({
      databaseIds: ['database-1'],
      dataSources: [{ databaseId: 'database-1', dataSourceId: 'source-1' }],
    })
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

  it('rejects an out-of-bounds compound data-source cursor', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({ data_sources: [{ id: 'source-1', name: 'Primary' }] })
    )

    await expect(
      notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: 'database-1' },
        JSON.stringify({ sourceIndex: 3 })
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

  it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid persisted maxPages %s before listing from Notion',
    async (maxPages) => {
      await expect(notionConnector.listDocuments('token', { maxPages })).rejects.toThrow(
        'Max pages must be a positive safe integer, or 0 for unlimited'
      )
      expect(mockFetchWithRetry).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, null, '', '   ', 0, '0'])(
    'keeps omitted or explicit unlimited maxPages %s valid at runtime',
    async (maxPages) => {
      mockFetchWithRetry.mockResolvedValueOnce(
        notionResponse({ results: [], has_more: false, next_cursor: null })
      )

      await expect(notionConnector.listDocuments('token', { maxPages })).resolves.toMatchObject({
        documents: [],
        hasMore: false,
      })
      const body = JSON.parse(
        String((mockFetchWithRetry.mock.calls[0][1] as RequestInit).body)
      ) as Record<string, unknown>
      expect(body.page_size).toBe(100)
    }
  )

  it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid maxPages %s during validation without calling Notion',
    async (maxPages) => {
      await expect(notionConnector.validateConfig('token', { maxPages })).resolves.toEqual({
        valid: false,
        error: 'Max pages must be a positive safe integer, or 0 for unlimited',
      })
      expect(mockFetchWithRetry).not.toHaveBeenCalled()
    }
  )
})
