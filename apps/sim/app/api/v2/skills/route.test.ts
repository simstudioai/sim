/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      capture: vi.fn(),
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: vi.fn().mockReturnValue({
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/skills/application/use-cases', () => ({
  listSkillsUseCase: { operation: { id: 'skills.list' }, execute: mocks.list },
  createSkillUseCase: { operation: { id: 'skills.create' }, execute: mocks.create },
}))

import { GET, POST } from '@/app/api/v2/skills/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: ['workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T00:00:00Z'),
  retryAfterMs: 0,
}
const skill = {
  id: 'skill-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  name: 'refund-policy',
  description: 'How to handle refunds',
  content: '# Refund policy',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

function request(method: 'GET' | 'POST', url: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.list.mockResolvedValue({ skills: [skill], hasMore: false, offset: 0, limit: 50 })
    mocks.create.mockResolvedValue({ skill })
  })

  it('lists skill summaries through the authorized application use case', async () => {
    const response = await GET(request('GET', `/api/v2/skills?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data[0]).not.toHaveProperty('content')
    expect(body.nextCursor).toBeNull()
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: 50,
        cursor: undefined,
        offset: 0,
      },
      request: expect.anything(),
    })
  })

  it('resumes from the offset cursor and mints the next one while pages remain', async () => {
    mocks.list.mockResolvedValueOnce({ skills: [skill], hasMore: true, offset: 2, limit: 2 })
    const cursor = Buffer.from(JSON.stringify({ offset: 2 })).toString('base64')

    const response = await GET(
      request(
        'GET',
        `/api/v2/skills?workspaceId=${WORKSPACE_ID}&limit=2&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(200)
    expect((await response.json()).nextCursor).toBe(
      Buffer.from(JSON.stringify({ offset: 4 })).toString('base64')
    )
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ limit: 2, offset: 2 }) })
    )
  })

  it('rejects a malformed cursor rather than silently restarting at page one', async () => {
    const response = await GET(
      request('GET', `/api/v2/skills?workspaceId=${WORKSPACE_ID}&cursor=not-a-cursor`)
    )

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('creates a skill with the v2 source and status', async () => {
    const response = await POST(
      request('POST', '/api/v2/skills', {
        workspaceId: WORKSPACE_ID,
        name: skill.name,
        description: skill.description,
        content: skill.content,
      })
    )

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe(skill.id)
    expect(mocks.create).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: 'api',
      },
      request: expect.anything(),
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('keeps skill analytics on the personal-key v2 surface', async () => {
    mocks.authenticate.mockResolvedValueOnce({
      ...AUTH,
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-personal' },
      keyType: 'personal',
    })

    const response = await POST(
      request('POST', '/api/v2/skills', {
        workspaceId: WORKSPACE_ID,
        name: skill.name,
        description: skill.description,
        content: skill.content,
      })
    )

    expect(response.status).toBe(201)
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'skill_created',
      expect.objectContaining({ skill_id: skill.id, source: 'api' }),
      expect.anything()
    )
  })

  it('authenticates before parsing skill input', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(request('POST', '/api/v2/skills', {}))

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
