/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkPreauth: vi.fn(),
  checkOperationRate: vi.fn(),
  gate: vi.fn(),
  listRuns: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkPreauth
    checkRateLimitDirectOrThrow = mocks.checkOperationRate
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

vi.mock('@/lib/copilot/chat/application/runs', () => ({
  listChatRuns: {
    operation: { id: 'chat.runs.list' },
    execute: mocks.listRuns,
  },
}))

import { PrincipalKindAuthorizationError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/chat/runs/route'

const RUN_ID = '4bfa6f89-b746-43be-8246-bf1c69b58593'
const CHAT_ID = '80a47295-040e-46f9-9ea8-ad78eff3bcab'
const auth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'key-1',
  },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const run = {
  runId: RUN_ID,
  chatId: CHAT_ID,
  chatTitle: 'Release plan',
  streamId: 'stream-1',
  status: 'complete' as const,
  startedAt: new Date('2026-08-08T12:00:00.000Z'),
  completedAt: new Date('2026-08-08T12:01:00.000Z'),
}

function callList(query = 'workspaceId=workspace-1') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/chat/runs?${query}`))
}

describe('GET /api/v2/chat/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkPreauth.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-08T13:00:00.000Z'),
    })
    mocks.checkOperationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-08T13:00:00.000Z'),
    })
    mocks.listRuns.mockResolvedValue({ rows: [], hasMore: false })
  })

  it('routes validated list input through the semantic application operation', async () => {
    mocks.listRuns.mockResolvedValue({ rows: [run], hasMore: true })
    const request = new NextRequest(
      'http://localhost:3000/api/v2/chat/runs?workspaceId=workspace-1&status=complete&limit=1'
    )

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([
      {
        runId: RUN_ID,
        chatId: CHAT_ID,
        chatTitle: 'Release plan',
        status: 'complete',
        startedAt: '2026-08-08T12:00:00.000Z',
        completedAt: '2026-08-08T12:01:00.000Z',
      },
    ])
    expect(body.nextCursor).toEqual(expect.any(String))
    expect(mocks.listRuns).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: 'workspace-1',
        status: 'complete',
        limit: 1,
        cursorKeys: undefined,
      },
      request,
    })
    expect(mocks.checkOperationRate).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed cursors before application execution', async () => {
    const response = await callList('workspaceId=workspace-1&cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toMatch(/cursor does not match/i)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  it('renders the personal-key-only operation failure consistently', async () => {
    mocks.listRuns.mockRejectedValue(
      new PrincipalKindAuthorizationError('workspace_api_key', 'chat.runs.list')
    )

    const response = await callList()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Chat runs require a personal API key' },
    })
  })
})
