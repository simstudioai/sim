import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
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
vi.mock('@/lib/secrets/application/use-cases', () => ({
  setSecretUseCase: { operation: { id: 'secrets.set' }, execute: mocks.set },
  deleteSecretUseCase: { operation: { id: 'secrets.delete' }, execute: mocks.remove },
}))

import { PUT } from '@/app/api/v2/secrets/[name]/route'

const WORKSPACE_ID = 'workspace-1'
const SECRET_NAME = 'STRIPE_API_KEY'
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
const secret = {
  id: 'secret-1',
  workspaceId: WORKSPACE_ID,
  type: 'env_workspace' as const,
  displayName: SECRET_NAME,
  description: null,
  providerId: null,
  accountId: null,
  envKey: SECRET_NAME,
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: false,
  role: 'admin' as const,
  unredacted: false,
}
const context = { params: Promise.resolve({ name: SECRET_NAME }) }

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'PUT' | 'DELETE', body?: unknown) {
  const query = method === 'DELETE' ? `?workspaceId=${WORKSPACE_ID}&scope=workspace` : ''
  return new NextRequest(`http://localhost:3000/api/v2/secrets/${SECRET_NAME}${query}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/secrets/[name]', () => {
  beforeEach(() => {
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.set.mockResolvedValue({ secret, userId: 'user-1', created: true })
    mocks.remove.mockResolvedValue({ name: SECRET_NAME, scope: 'workspace' })
  })

  it('creates a write-only secret with a dynamic 201 status', async () => {
    const response = await PUT(
      request('PUT', { workspaceId: WORKSPACE_ID, scope: 'workspace', value: 'secret-value' }),
      context
    )

    expect(response.status).toBe(201)
    expect(JSON.stringify(await response.json())).not.toContain('secret-value')
    expect(mocks.set).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: SECRET_NAME,
        scope: 'workspace',
        value: 'secret-value',
      },
      request: expect.anything(),
    })
  })

  it('omits description entirely when unset so a rotation cannot erase it', async () => {
    await PUT(
      request('PUT', { workspaceId: WORKSPACE_ID, scope: 'workspace', value: 'rotated' }),
      context
    )

    expect(mocks.set.mock.calls[0][0].input).not.toHaveProperty('description')
  })

  it('normalizes an empty description to null so it matches the UI clear path', async () => {
    await PUT(
      request('PUT', {
        workspaceId: WORKSPACE_ID,
        scope: 'workspace',
        value: 'secret-value',
        description: '   ',
      }),
      context
    )

    expect(mocks.set.mock.calls[0][0].input.description).toBeNull()
  })

  it('returns 200 when replacing an existing secret', async () => {
    mocks.set.mockResolvedValueOnce({ secret, userId: 'user-1', created: false })

    const response = await PUT(
      request('PUT', { workspaceId: WORKSPACE_ID, scope: 'workspace', value: 'replacement' }),
      context
    )

    expect(response.status).toBe(200)
  })

  it('sends a value-less workspace write through as a metadata-only update at 200', async () => {
    mocks.set.mockResolvedValueOnce({ secret, userId: 'user-1', created: false })

    const response = await PUT(
      request('PUT', { workspaceId: WORKSPACE_ID, scope: 'workspace', unredacted: false }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.set).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: SECRET_NAME,
        scope: 'workspace',
        unredacted: false,
      },
      request: expect.anything(),
    })
    expect(mocks.set.mock.calls[0][0].input).not.toHaveProperty('value')
  })
})
