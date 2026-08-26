/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/catalog/application/list-blocks', () => ({
  listCatalogBlocks: { operation: { id: 'catalog.blocks.list' }, execute: mocks.list },
}))
vi.mock('@/lib/catalog/application/get-block', () => ({
  getCatalogBlock: { operation: { id: 'catalog.blocks.read' }, execute: mocks.read },
}))

import { v2ListBlocksContract } from '@/lib/api/contracts/v2/catalog'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as GET_BLOCK } from '@/app/api/v2/blocks/[blockId]/route'
import { GET } from '@/app/api/v2/blocks/route'
import { cursorSortKey, encodeOffsetCursor } from '@/app/api/v2/lib/response'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const summary = {
  id: 'slack',
  name: 'Slack',
  description: 'Send messages in Slack.',
  category: 'tools',
  source: 'builtin' as const,
  triggerAllowed: true,
  triggerCapable: true,
  triggerIds: [],
  toolIds: ['slack_message'],
  operationIds: ['send'],
  preview: false,
  tags: ['messaging'],
}

const detail = {
  ...summary,
  inputSchema: [],
  operationInputSchema: {},
  inputDefinitions: {},
  operations: {},
  tools: [],
  triggers: [],
  outputs: {},
}

/** A cursor exactly as this route mints one, built from the shared codec. */
function blockCursor({
  offset,
  search,
  category,
  capability,
  source,
  sortBy = 'id',
  sortOrder = 'asc',
}: {
  offset: number
  search?: string
  category?: string
  capability?: string
  source?: string
  sortBy?: string
  sortOrder?: string
}): string {
  return encodeOffsetCursor(
    cursorSortKey(sortBy, sortOrder),
    cursorScopeKey(cursorRoute(v2ListBlocksContract), {
      workspaceId: WORKSPACE_ID,
      search,
      category,
      capability,
      source,
    }),
    offset
  )
}

function request(url: string) {
  return new NextRequest(`http://localhost:3000${url}`, { headers: { 'x-api-key': 'key' } })
}

describe('/api/v2/blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ entries: [summary], hasMore: false, offset: 0, limit: 50 })
    mocks.read.mockResolvedValue({ block: detail })
  })

  it('returns the v2 list envelope and keeps the response out of shared caches', async () => {
    const response = await GET(request(`/api/v2/blocks?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [summary], nextCursor: null })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        search: undefined,
        category: undefined,
        capability: undefined,
        source: undefined,
        sortBy: 'id',
        sortOrder: 'asc',
        limit: 50,
        cursor: undefined,
        offset: 0,
      },
      request: expect.anything(),
    })
  })

  it('resumes from the offset cursor and mints the next one while pages remain', async () => {
    mocks.list.mockResolvedValue({ entries: [summary], hasMore: true, offset: 2, limit: 2 })
    const cursor = blockCursor({ offset: 2 })

    const response = await GET(
      request(
        `/api/v2/blocks?workspaceId=${WORKSPACE_ID}&limit=2&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(200)
    expect((await response.json()).nextCursor).toBe(blockCursor({ offset: 4 }))
  })

  it('rejects a cursor replayed after a filter change', async () => {
    const cursor = blockCursor({ offset: 2 })

    const response = await GET(
      request(
        `/api/v2/blocks?workspaceId=${WORKSPACE_ID}&capability=trigger&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown param', 'bogus=1'],
    ['a fractional limit', 'limit=1.5'],
    ['a zero limit', 'limit=0'],
    ['an over-cap limit', 'limit=101'],
    ['an empty search', 'search='],
    ['an unknown sort field', 'sortBy=popularity'],
    ['an unknown capability', 'capability=response'],
  ])('rejects %s instead of ignoring it', async (_label, query) => {
    const response = await GET(request(`/api/v2/blocks?workspaceId=${WORKSPACE_ID}&${query}`))

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('names the bound in a limit rejection', async () => {
    const response = await GET(request(`/api/v2/blocks?workspaceId=${WORKSPACE_ID}&limit=101`))

    expect((await response.json()).error.message).toContain('limit cannot exceed 100')
  })

  it('conceals a workspace the caller cannot reach as absent', async () => {
    mocks.list.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))

    const response = await GET(request(`/api/v2/blocks?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    })
  })
})

describe('/api/v2/blocks/[blockId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue({ block: detail })
  })

  it('returns one block in the single-resource envelope', async () => {
    const response = await GET_BLOCK(request(`/api/v2/blocks/slack?workspaceId=${WORKSPACE_ID}`), {
      params: Promise.resolve({ blockId: 'slack' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: detail })
    expect(mocks.read).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID, blockId: 'slack' },
      request: expect.anything(),
    })
  })

  it('requires the workspace whose availability rules decide the answer', async () => {
    const response = await GET_BLOCK(request('/api/v2/blocks/slack'), {
      params: Promise.resolve({ blockId: 'slack' }),
    })

    expect(response.status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('answers not found for a block this caller cannot see', async () => {
    mocks.read.mockRejectedValue(new OrchestrationError('not_found', 'Block not found'))

    const response = await GET_BLOCK(
      request(`/api/v2/blocks/preview_thing?workspaceId=${WORKSPACE_ID}`),
      { params: Promise.resolve({ blockId: 'preview_thing' }) }
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Block not found')
  })
})
