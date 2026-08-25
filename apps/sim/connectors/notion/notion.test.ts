/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry, mockReadBoundedHttpErrorPayload } = vi.hoisted(() => ({
  mockFetchWithRetry: vi.fn(),
  mockReadBoundedHttpErrorPayload: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  readBoundedHttpErrorPayload: mockReadBoundedHttpErrorPayload,
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
    expect(document?.contentHash).toBe('notion:v3:page-1:2026-08-02T00:00:00.000Z')
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
    expect(mockFetchWithRetry.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.notion.com/v1/pages/page-1',
      'https://api.notion.com/v1/pages/page-1/markdown?include_transcript=true',
    ])

    for (const [, options] of mockFetchWithRetry.mock.calls) {
      expect(((options as RequestInit).headers as Record<string, string>)['Notion-Version']).toBe(
        '2026-03-11'
      )
    }
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

  it('recovers truncated markdown from every provider-supplied block ID', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({
          markdown: '# Root\n\n<unknown>',
          truncated: true,
          unknown_block_ids: ['nested-1'],
        })
      )
      .mockResolvedValueOnce(
        notionResponse({
          markdown: 'Recovered nested content',
          truncated: false,
          unknown_block_ids: [],
        })
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.content).toContain('# Root')
    expect(document?.content).toContain('Recovered nested content')
    expect(mockFetchWithRetry.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.notion.com/v1/pages/page-1',
      'https://api.notion.com/v1/pages/page-1/markdown?include_transcript=true',
      'https://api.notion.com/v1/pages/nested-1/markdown?include_transcript=true',
    ])
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

  it('marks an inaccessible unsupported-block fallback retryable', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({
          markdown: 'Before unsupported block: <unknown>',
          truncated: false,
          unknown_block_ids: ['bookmark-1'],
        })
      )
      .mockResolvedValueOnce(
        notionResponse(
          {
            object: 'error',
            code: 'object_not_found',
            message: 'Block is inaccessible',
            request_id: 'request-bookmark-1',
          },
          404
        )
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document).toMatchObject({
      content: '',
      contentHash: 'notion:v3:page-1:2026-08-02T00:00:00.000Z',
      skippedRetryContentHash: 'notion:retry:v1:page-1',
      skippedReason:
        'Notion page contains blocks the connection cannot access and was not indexed completely',
    })
  })

  it('uses the block endpoint to recover unsupported markdown block types', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({
          markdown: 'Before unsupported block: <unknown>',
          truncated: false,
          unknown_block_ids: ['bookmark-1'],
        })
      )
      .mockResolvedValueOnce(
        notionResponse({
          object: 'block',
          id: 'bookmark-1',
          type: 'bookmark',
          bookmark: {
            caption: [{ plain_text: 'Provider documentation' }],
            url: 'https://developers.notion.com/',
          },
        })
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document?.content).toContain('Provider documentation')
    expect(document?.content).toContain('https://developers.notion.com/')
    expect(String(mockFetchWithRetry.mock.calls[2][0])).toBe(
      'https://api.notion.com/v1/blocks/bookmark-1'
    )
  })

  it('recovers the expression from an unsupported equation block', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse(page()))
      .mockResolvedValueOnce(
        notionResponse({
          markdown: 'Before unsupported equation: <unknown>',
          truncated: false,
          unknown_block_ids: ['equation-1'],
        })
      )
      .mockResolvedValueOnce(
        notionResponse({
          object: 'block',
          id: 'equation-1',
          type: 'equation',
          equation: { expression: 'e=mc^2' },
        })
      )

    const document = await notionConnector.getDocument('token', {}, 'page-1')

    expect(document).toMatchObject({ contentDeferred: false })
    expect(document?.content).toContain('e=mc^2')
    expect(document?.skippedReason).toBeUndefined()
    expect(String(mockFetchWithRetry.mock.calls[2][0])).toBe(
      'https://api.notion.com/v1/blocks/equation-1'
    )
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

  it('omits free-form provider diagnostics from the markdown endpoint', async () => {
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
      'Failed to fetch markdown for page-1: 400, code=validation_error, requestId=request-2'
    )
  })

  it('preserves only machine identifiers from a valid error envelope larger than 2KB', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(notionResponse(page())).mockResolvedValueOnce(
      notionResponse(
        {
          object: 'error',
          padding: 'x'.repeat(3000),
          code: 'validation_error',
          message: 'The start_cursor provided is invalid',
          request_id: 'request-large',
        },
        400
      )
    )

    await expect(notionConnector.getDocument('token', {}, 'page-1')).rejects.toThrow(
      'Failed to fetch markdown for page-1: 400, code=validation_error, requestId=request-large'
    )
  })

  it('degrades to status-only diagnostics when the bounded error payload is unavailable', async () => {
    mockReadBoundedHttpErrorPayload.mockResolvedValueOnce({ ok: false, reason: 'too_large' })
    mockFetchWithRetry.mockResolvedValueOnce(notionResponse(page())).mockResolvedValueOnce(
      notionResponse(
        {
          object: 'error',
          code: 'validation_error',
          message: 'This diagnostic must not be consumed',
          request_id: 'request-omitted',
        },
        400
      )
    )

    await expect(notionConnector.getDocument('token', {}, 'page-1')).rejects.toMatchObject({
      message: 'Failed to fetch markdown for page-1: 400',
      status: 400,
      code: undefined,
      requestId: undefined,
    })
    expect(mockReadBoundedHttpErrorPayload).toHaveBeenCalledTimes(1)
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
    expect(first.nextCursor).toBe(dataSourceCursor({ sourceIndex: 1 }))
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

  it('wraps a new provider cursor even when only one data source is configured', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        notionResponse({ data_sources: [{ id: 'source-1', name: 'Primary' }] })
      )
      .mockResolvedValueOnce(
        notionResponse({ results: [page('page-1')], has_more: true, next_cursor: 'provider-next' })
      )

    const result = await notionConnector.listDocuments('token', {
      scope: 'database',
      databaseId: 'database-1',
    })

    expect(result.nextCursor).toBe(dataSourceCursor({ sourceIndex: 0, cursor: 'provider-next' }))
  })

  it('passes a JSON-looking provider cursor through without interpreting it', async () => {
    const providerCursor = JSON.stringify({ databaseIndex: 0, cursor: 'provider-opaque' })
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
      providerCursor
    )

    const queryBody = JSON.parse(
      String((mockFetchWithRetry.mock.calls[1][1] as RequestInit).body)
    ) as Record<string, unknown>
    expect(queryBody.start_cursor).toBe(providerCursor)
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

  it.each([
    '{"databaseIndex":1',
    JSON.stringify({ databaseIndex: '1', cursor: 'provider-cursor' }),
    JSON.stringify({ databaseIndex: 1, cursor: 'provider-cursor', provider: true }),
  ])('keeps malformed or lookalike JSON provider cursor opaque: %s', async (providerCursor) => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse({ data_sources: [{ id: 'database-1-source-1' }] }))
      .mockResolvedValueOnce(notionResponse({ data_sources: [{ id: 'database-2-source-1' }] }))
      .mockResolvedValueOnce(
        notionResponse({ results: [page('page-1')], has_more: false, next_cursor: null })
      )

    await notionConnector.listDocuments(
      'token',
      { scope: 'database', databaseId: ['database-1', 'database-2'] },
      providerCursor
    )

    expect(String(mockFetchWithRetry.mock.calls[2][0])).toBe(
      'https://api.notion.com/v1/data_sources/database-1-source-1/query'
    )
    const queryBody = JSON.parse(
      String((mockFetchWithRetry.mock.calls[2][1] as RequestInit).body)
    ) as Record<string, unknown>
    expect(queryBody.start_cursor).toBe(providerCursor)
  })

  it('rejects an out-of-range production legacy database cursor', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(notionResponse({ data_sources: [{ id: 'database-1-source-1' }] }))
      .mockResolvedValueOnce(notionResponse({ data_sources: [{ id: 'database-2-source-1' }] }))

    await expect(
      notionConnector.listDocuments(
        'token',
        { scope: 'database', databaseId: ['database-1', 'database-2'] },
        JSON.stringify({ databaseIndex: 2 })
      )
    ).rejects.toThrow('Invalid Notion connector legacy database cursor')
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
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

  it('caps parent metadata concurrency and preserves documents after out-of-order completion', async () => {
    const childIds = Array.from({ length: 5 }, (_, index) => `child-${index + 1}`)
    const pending = new Map<string, (response: Response) => void>()
    let activeRequests = 0
    let peakRequests = 0

    mockFetchWithRetry.mockImplementation((url: string) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/blocks/root-page/children')) {
        return Promise.resolve(
          notionResponse({
            results: childIds.map((id) => ({ id, type: 'child_page' })),
            has_more: false,
            next_cursor: null,
          })
        )
      }

      const pageId = decodeURIComponent(requestUrl.split('/pages/')[1] ?? '')
      activeRequests += 1
      peakRequests = Math.max(peakRequests, activeRequests)
      return new Promise<Response>((resolve) => {
        pending.set(pageId, (response) => {
          pending.delete(pageId)
          activeRequests -= 1
          resolve(response)
        })
      })
    })

    const listingPromise = notionConnector.listDocuments('token', {
      scope: 'page',
      rootPageId: 'root-page',
    })

    await vi.waitFor(() => {
      expect([...pending.keys()].sort()).toEqual(['child-1', 'child-2', 'root-page'])
    })
    pending.get('child-2')?.(notionResponse(page('child-2')))
    pending.get('root-page')?.(notionResponse(page('root-page')))
    pending.get('child-1')?.(notionResponse(page('child-1')))

    await vi.waitFor(() => {
      expect([...pending.keys()].sort()).toEqual(['child-3', 'child-4', 'child-5'])
    })
    pending.get('child-5')?.(notionResponse(page('child-5')))
    pending.get('child-3')?.(notionResponse(page('child-3')))
    pending.get('child-4')?.(notionResponse(page('child-4')))

    const result = await listingPromise

    expect(peakRequests).toBe(3)
    expect(result.documents.map((document) => document.externalId)).toEqual([
      'root-page',
      'child-1',
      'child-2',
      'child-3',
      'child-4',
      'child-5',
    ])
  })

  it('keeps all metadata failures non-authoritative under a small maxPages cap', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(
      notionResponse({
        results: [
          { id: 'child-1', type: 'child_page' },
          { id: 'child-2', type: 'child_page' },
          { id: 'child-3', type: 'child_page' },
        ],
        has_more: false,
        next_cursor: null,
      })
    )
    for (const pageId of ['root-page', 'child-1', 'child-2', 'child-3']) {
      mockFetchWithRetry.mockResolvedValueOnce(
        notionResponse(
          {
            object: 'error',
            code: 'internal_server_error',
            message: `Temporary failure for ${pageId}`,
            request_id: `request-${pageId}`,
          },
          503
        )
      )
    }
    const syncContext: Record<string, unknown> = {}

    const result = await notionConnector.listDocuments(
      'token',
      { scope: 'page', rootPageId: 'root-page', maxPages: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(5)
    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.reconciliationUnsafe).toBe(true)
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
