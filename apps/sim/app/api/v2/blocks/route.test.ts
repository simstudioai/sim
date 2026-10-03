import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/catalog/application/list-blocks', () => ({
  listCatalogBlocks: { operation: { id: 'catalog.blocks.list' }, execute: mocks.list },
}))

import { v2ListBlocksContract } from '@/lib/api/contracts/v2/catalog'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
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

/** A cursor exactly as this route mints one, built from the shared codec. */
function blockCursor({
  offset,
  search,
  category,
  capability,
  source,
  includeSunset = false,
  sortBy = 'id',
  sortOrder = 'asc',
}: {
  offset: number
  search?: string
  category?: string
  capability?: string
  source?: string
  includeSunset?: boolean
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
      includeSunset,
    }),
    offset
  )
}

function request(url: string) {
  return new NextRequest(`http://localhost:3000${url}`, { headers: { 'x-api-key': 'key' } })
}

describe('/api/v2/blocks', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ entries: [summary], hasMore: false, offset: 0, limit: 50 })
  })

  it('asks for sunset blocks only when includeSunset is set, and stamps it into the cursor', async () => {
    const response = await GET(
      request(`/api/v2/blocks?workspaceId=${WORKSPACE_ID}&includeSunset=true`)
    )

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ includeSunset: true }) })
    )

    const cursor = blockCursor({ offset: 2 })
    const replayed = await GET(
      request(
        `/api/v2/blocks?workspaceId=${WORKSPACE_ID}&includeSunset=true&cursor=${encodeURIComponent(cursor)}`
      )
    )
    expect(replayed.status).toBe(400)
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
})
