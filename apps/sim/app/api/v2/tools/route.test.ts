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
vi.mock('@/lib/catalog/application/list-tools', () => ({
  listCatalogTools: { operation: { id: 'catalog.tools.list' }, execute: mocks.list },
}))

import { v2ListToolsContract } from '@/lib/api/contracts/v2/catalog'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { cursorSortKey, encodeOffsetCursor } from '@/app/api/v2/lib/response'
import { GET } from '@/app/api/v2/tools/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const summary = {
  id: 'slack_message',
  name: 'Slack Send Message',
  description: 'Send a message.',
  version: '1.0.0',
  hostedApiKey: 'none' as const,
}

function toolCursor({
  offset,
  search,
  hostedApiKey,
  oauthProvider,
  sortBy = 'id',
  sortOrder = 'asc',
}: {
  offset: number
  search?: string
  hostedApiKey?: string
  oauthProvider?: string
  sortBy?: string
  sortOrder?: string
}): string {
  return encodeOffsetCursor(
    cursorSortKey(sortBy, sortOrder),
    cursorScopeKey(cursorRoute(v2ListToolsContract), {
      workspaceId: WORKSPACE_ID,
      search,
      hostedApiKey,
      oauthProvider,
    }),
    offset
  )
}

function request(url: string) {
  return new NextRequest(`http://localhost:3000${url}`, { headers: { 'x-api-key': 'key' } })
}

describe('/api/v2/tools', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ entries: [summary], hasMore: false, offset: 0, limit: 50 })
  })

  it('resumes from the offset cursor and mints the next one while pages remain', async () => {
    mocks.list.mockResolvedValue({ entries: [summary], hasMore: true, offset: 100, limit: 100 })
    const cursor = toolCursor({ offset: 100 })

    const response = await GET(
      request(
        `/api/v2/tools?workspaceId=${WORKSPACE_ID}&limit=100&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect((await response.json()).nextCursor).toBe(toolCursor({ offset: 200 }))
  })

  it('rejects a cursor replayed after the hosted-key filter changes', async () => {
    const cursor = toolCursor({ offset: 100 })

    const response = await GET(
      request(
        `/api/v2/tools?workspaceId=${WORKSPACE_ID}&hostedApiKey=always&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
