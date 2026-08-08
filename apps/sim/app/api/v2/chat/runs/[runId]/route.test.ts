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
  readRun: vi.fn(),
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
  readChatRun: {
    operation: { id: 'chat.runs.read' },
    execute: mocks.readRun,
  },
}))

import { ChatRunProgressUnavailableError } from '@/lib/copilot/chat/application/errors'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/chat/runs/[runId]/route'

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
  status: 'active' as const,
  startedAt: new Date('2026-08-08T12:00:00.000Z'),
  completedAt: null,
}
const context = () => ({ params: Promise.resolve({ runId: RUN_ID }) })

function callDetail() {
  return GET(
    new NextRequest(`http://localhost:3000/api/v2/chat/runs/${RUN_ID}?workspaceId=workspace-1`),
    context()
  )
}

describe('GET /api/v2/chat/runs/[runId]', () => {
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
    mocks.readRun.mockResolvedValue({
      run,
      status: 'active',
      completedAt: null,
      response: 'Working',
      activities: [{ kind: 'tool', id: 'tool-1', label: 'Reading file', state: 'running' }],
    })
  })

  it('projects the authorized application result through the public contract', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/chat/runs/${RUN_ID}?workspaceId=workspace-1`
    )
    const response = await GET(request, context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        runId: RUN_ID,
        chatId: CHAT_ID,
        chatTitle: 'Release plan',
        status: 'active',
        startedAt: '2026-08-08T12:00:00.000Z',
        completedAt: null,
        response: 'Working',
        activities: [{ kind: 'tool', id: 'tool-1', label: 'Reading file', state: 'running' }],
      },
    })
    expect(mocks.readRun).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { runId: RUN_ID, workspaceId: 'workspace-1' },
      request,
    })
  })

  it.each([
    new InsufficientWorkspacePermissionsError(),
    new OrchestrationError('not_found', 'Workspace not found'),
    new OrchestrationError('not_found', 'Chat run not found'),
  ])('uniformly conceals inaccessible scoped runs', async (error) => {
    mocks.readRun.mockRejectedValue(error)

    const response = await callDetail()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Chat run not found' },
    })
  })

  it('returns a retryable 503 for temporarily unavailable progress', async () => {
    mocks.readRun.mockRejectedValue(new ChatRunProgressUnavailableError())

    const response = await callDetail()

    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('does not disguise unexpected infrastructure failures as absence', async () => {
    mocks.readRun.mockRejectedValue(new Error('database unavailable'))

    const response = await callDetail()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
