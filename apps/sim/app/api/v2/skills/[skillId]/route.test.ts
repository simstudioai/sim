import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
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
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/skills/application/use-cases', () => ({
  getSkillUseCase: { operation: { id: 'skills.read' }, execute: mocks.get },
  updateSkillUseCase: { operation: { id: 'skills.update' }, execute: mocks.update },
  deleteSkillUseCase: { operation: { id: 'skills.delete' }, execute: mocks.remove },
}))

import { GET, PATCH } from '@/app/api/v2/skills/[skillId]/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-personal' }
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
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
  userId: 'user-1',
  name: 'refund-policy',
  description: 'How to handle refunds',
  content: '# Refund policy',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const context = { params: Promise.resolve({ skillId: skill.id }) }

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const query = method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`
  return new NextRequest(`http://localhost:3000/api/v2/skills/${skill.id}${query}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/skills/[skillId]', () => {
  beforeEach(() => {
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.get.mockResolvedValue({ skill })
    mocks.update.mockResolvedValue({ skill })
    mocks.remove.mockResolvedValue({ skill })
  })

  it('conceals cross-tenant access while preserving same-workspace role denials', async () => {
    mocks.get.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request('GET'), context)).status).toBe(404)

    mocks.update.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    expect(
      (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, content: '# Updated' }), context))
        .status
    ).toBe(403)
  })
})
