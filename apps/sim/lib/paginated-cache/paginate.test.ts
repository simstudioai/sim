/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient, mockStorePage, mockStoreMetadata, mockGetAllPages } = vi.hoisted(
  () => ({
    mockGetRedisClient: vi.fn(),
    mockStorePage: vi.fn(),
    mockStoreMetadata: vi.fn(),
    mockGetAllPages: vi.fn(),
  })
)

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))
vi.mock('@/lib/paginated-cache/redis-cache', () => ({
  RedisPaginatedCache: vi.fn().mockImplementation(() => ({
    storePage: mockStorePage,
    storeMetadata: mockStoreMetadata,
    getAllPages: mockGetAllPages,
  })),
}))

import { autoPaginate, hydrateCacheReferences } from '@/lib/paginated-cache/paginate'
import type { ToolResponse } from '@/tools/types'

function makePageResponse(items: unknown[], hasMore: boolean, cursor: string | null): ToolResponse {
  return {
    success: true,
    output: {
      tickets: items,
      paging: { has_more: hasMore, after_cursor: cursor },
      metadata: { total_returned: items.length, has_more: hasMore },
    },
  }
}

const paginationConfig = {
  pageField: 'tickets',
  getItems: (output: Record<string, unknown>) => (output.tickets as unknown[]) ?? [],
  getNextPageToken: (output: Record<string, unknown>) => {
    const paging = output.paging as Record<string, unknown> | undefined
    return paging?.has_more && paging?.after_cursor ? (paging.after_cursor as string) : null
  },
  buildNextPageParams: (params: Record<string, unknown>, token: string | number) => ({
    ...params,
    pageAfter: String(token),
  }),
}

describe('autoPaginate', () => {
  let mockExecuteTool: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue({})
    mockStorePage.mockResolvedValue(undefined)
    mockStoreMetadata.mockResolvedValue(undefined)
    mockExecuteTool = vi.fn()
  })

  it('throws when Redis is unavailable', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await expect(
      autoPaginate({
        initialResult: makePageResponse([{ id: 1 }], false, null),
        params: {},
        paginationConfig,
        executeTool: mockExecuteTool,
        toolId: 'zendesk_get_tickets',
        executionId: 'exec-1',
      })
    ).rejects.toThrow('Redis is required for auto-pagination but is not available')
  })

  it('handles a single page with no more pages', async () => {
    const initialResult = makePageResponse([{ id: 1 }, { id: 2 }], false, null)

    const result = await autoPaginate({
      initialResult,
      params: {},
      paginationConfig,
      executeTool: mockExecuteTool,
      toolId: 'zendesk_get_tickets',
      executionId: 'exec-1',
    })

    expect(mockStorePage).toHaveBeenCalledOnce()
    expect(mockStorePage).toHaveBeenCalledWith(expect.any(String), 0, [{ id: 1 }, { id: 2 }])
    expect(mockStoreMetadata).toHaveBeenCalledOnce()
    expect(mockStoreMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ totalPages: 1, totalItems: 2 })
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(result.output.tickets).toEqual(
      expect.objectContaining({ _type: 'paginated_cache_ref', totalPages: 1, totalItems: 2 })
    )
  })

  it('fetches all pages and preserves last page metadata', async () => {
    const initialResult = makePageResponse([{ id: 1 }], true, 'cursor-1')
    mockExecuteTool
      .mockResolvedValueOnce(makePageResponse([{ id: 2 }], true, 'cursor-2'))
      .mockResolvedValueOnce(makePageResponse([{ id: 3 }], false, null))

    const result = await autoPaginate({
      initialResult,
      params: { query: 'test' },
      paginationConfig,
      executeTool: mockExecuteTool,
      toolId: 'zendesk_get_tickets',
      executionId: 'exec-1',
    })

    expect(mockStorePage).toHaveBeenCalledTimes(3)
    expect(mockStoreMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ totalPages: 3, totalItems: 3 })
    )
    expect(result.output.tickets).toEqual(
      expect.objectContaining({ _type: 'paginated_cache_ref', totalPages: 3, totalItems: 3 })
    )
    expect(result.output.paging).toEqual({ has_more: false, after_cursor: null })
    expect(result.output.metadata).toEqual({ total_returned: 1, has_more: false })
  })

  it('respects maxPages', async () => {
    const configWithMax = { ...paginationConfig, maxPages: 2 }
    const initialResult = makePageResponse([{ id: 1 }], true, 'cursor-1')
    mockExecuteTool.mockResolvedValue(makePageResponse([{ id: 2 }], true, 'cursor-next'))

    const result = await autoPaginate({
      initialResult,
      params: {},
      paginationConfig: configWithMax,
      executeTool: mockExecuteTool,
      toolId: 'zendesk_get_tickets',
      executionId: 'exec-1',
    })

    expect(mockStorePage).toHaveBeenCalledTimes(2)
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(result.output.tickets).toEqual(expect.objectContaining({ totalPages: 2 }))
  })

  it('throws on page fetch failure', async () => {
    const initialResult = makePageResponse([{ id: 1 }], true, 'cursor-1')
    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      output: {},
      error: 'rate limited',
    })

    await expect(
      autoPaginate({
        initialResult,
        params: {},
        paginationConfig,
        executeTool: mockExecuteTool,
        toolId: 'zendesk_get_tickets',
        executionId: 'exec-1',
      })
    ).rejects.toThrow('Auto-pagination failed on page 1: rate limited')
  })

  it('passes executionContext and skipAutoPaginate for subsequent pages', async () => {
    const initialResult = makePageResponse([{ id: 1 }], true, 'cursor-1')
    mockExecuteTool.mockResolvedValueOnce(makePageResponse([{ id: 2 }], false, null))
    const mockContext = { workflowId: 'wf-1', executionId: 'exec-1' }

    await autoPaginate({
      initialResult,
      params: {},
      paginationConfig,
      executeTool: mockExecuteTool,
      toolId: 'zendesk_get_tickets',
      executionId: 'exec-1',
      executionContext: mockContext as never,
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'zendesk_get_tickets',
      expect.objectContaining({ pageAfter: 'cursor-1' }),
      false,
      mockContext,
      true
    )
  })

  it('generates cacheId with expected format', async () => {
    const initialResult = makePageResponse([{ id: 1 }], false, null)

    await autoPaginate({
      initialResult,
      params: {},
      paginationConfig,
      executeTool: mockExecuteTool,
      toolId: 'zendesk_get_tickets',
      executionId: 'exec-42',
    })

    const storedCacheId = mockStoreMetadata.mock.calls[0][0] as string
    expect(storedCacheId).toMatch(
      /^exec-42:zendesk_get_tickets:tickets:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('does not inject fields that the tool output does not have', async () => {
    const noMetadataConfig = {
      ...paginationConfig,
      pageField: 'items',
      getItems: (output: Record<string, unknown>) => (output.items as unknown[]) ?? [],
    }
    const initialResult: ToolResponse = {
      success: true,
      output: {
        items: [{ id: 1 }],
        cursor: 'abc',
      },
    }

    const result = await autoPaginate({
      initialResult,
      params: {},
      paginationConfig: noMetadataConfig,
      executeTool: mockExecuteTool,
      toolId: 'custom_tool',
      executionId: 'exec-1',
    })

    const outputKeys = Object.keys(result.output)
    expect(outputKeys).toContain('items')
    expect(outputKeys).toContain('cursor')
    expect(outputKeys).not.toContain('metadata')
    expect(outputKeys).not.toContain('paging')
  })
})

describe('cleanupPaginatedCache', () => {
  let mockScan: ReturnType<typeof vi.fn>
  let mockDel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockScan = vi.fn().mockResolvedValue(['0', []])
    mockDel = vi.fn().mockResolvedValue(1)
    mockGetRedisClient.mockReturnValue({ scan: mockScan, del: mockDel })
  })

  it('scans with prefix-based patterns and deletes matching keys', async () => {
    mockScan
      .mockResolvedValueOnce(['0', ['pagcache:page:exec-1:tool:field:uuid:0']])
      .mockResolvedValueOnce(['0', ['pagcache:meta:exec-1:tool:field:uuid']])

    const { cleanupPaginatedCache } = await import('@/lib/paginated-cache/paginate')
    await cleanupPaginatedCache('exec-1')

    expect(mockScan).toHaveBeenCalledWith('0', 'MATCH', 'pagcache:page:exec-1:*', 'COUNT', 100)
    expect(mockScan).toHaveBeenCalledWith('0', 'MATCH', 'pagcache:meta:exec-1:*', 'COUNT', 100)
    expect(mockDel).toHaveBeenCalledTimes(2)
  })

  it('no-ops when Redis is unavailable', async () => {
    mockGetRedisClient.mockReturnValue(null)

    const { cleanupPaginatedCache } = await import('@/lib/paginated-cache/paginate')
    await cleanupPaginatedCache('exec-1')

    expect(mockScan).not.toHaveBeenCalled()
  })
})

describe('hydrateCacheReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue({})
    mockGetAllPages.mockResolvedValue([])
  })

  it('returns the same object by reference when no refs present', async () => {
    const input = { name: 'test', count: 42, nested: { value: true } }

    const result = await hydrateCacheReferences(input)

    expect(result).toBe(input)
    expect(mockGetAllPages).not.toHaveBeenCalled()
  })

  it('hydrates a single reference', async () => {
    mockGetAllPages.mockResolvedValue([
      { pageIndex: 0, itemCount: 2, items: [{ id: 1 }, { id: 2 }], storedAt: 100 },
      { pageIndex: 1, itemCount: 1, items: [{ id: 3 }], storedAt: 200 },
    ])

    const input = {
      tickets: {
        _type: 'paginated_cache_ref' as const,
        cacheId: 'cache-123',
        totalPages: 2,
        totalItems: 3,
        pageField: 'tickets',
      },
    }

    const result = await hydrateCacheReferences(input)

    expect(result.tickets).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(mockGetAllPages).toHaveBeenCalledWith('cache-123', 2)
  })

  it('hydrates a nested reference', async () => {
    mockGetAllPages.mockResolvedValue([
      { pageIndex: 0, itemCount: 1, items: ['item-a'], storedAt: 100 },
    ])

    const input = {
      data: {
        inner: {
          _type: 'paginated_cache_ref' as const,
          cacheId: 'cache-nested',
          totalPages: 1,
          totalItems: 1,
          pageField: 'items',
        },
      },
    }

    const result = await hydrateCacheReferences(input)

    expect((result.data as Record<string, unknown>).inner).toEqual(['item-a'])
  })

  it('throws when Redis is unavailable during hydration', async () => {
    mockGetRedisClient.mockReturnValue(null)

    const input = {
      tickets: {
        _type: 'paginated_cache_ref' as const,
        cacheId: 'cache-no-redis',
        totalPages: 1,
        totalItems: 1,
        pageField: 'tickets',
      },
    }

    await expect(hydrateCacheReferences(input)).rejects.toThrow(
      'Redis is required to hydrate paginated cache reference'
    )
  })

  it('throws when getAllPages fails', async () => {
    mockGetAllPages.mockRejectedValue(new Error('Connection lost'))

    const input = {
      tickets: {
        _type: 'paginated_cache_ref' as const,
        cacheId: 'cache-fail',
        totalPages: 2,
        totalItems: 10,
        pageField: 'tickets',
      },
    }

    await expect(hydrateCacheReferences(input)).rejects.toThrow('Connection lost')
  })
})
