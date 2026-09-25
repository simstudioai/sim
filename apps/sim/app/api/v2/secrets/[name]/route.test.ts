import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  secretsUseCasesMock,
  secretsUseCasesMockFns,
} from '@sim/testing/mocks/secrets-use-cases.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/secrets/application/use-cases', () => secretsUseCasesMock)

import { PUT } from '@/app/api/v2/secrets/[name]/route'

const mocks = {
  set: secretsUseCasesMockFns.mockSetSecretUseCase,
  remove: secretsUseCasesMockFns.mockDeleteSecretUseCase,
}

const WORKSPACE_ID = 'workspace-1'
const SECRET_NAME = 'STRIPE_API_KEY'
const PRINCIPAL = createPersonalApiKeyPrincipal({ keyId: 'key-personal' })
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
const context = createRouteContext({ name: SECRET_NAME })

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'PUT' | 'DELETE', body?: unknown) {
  const query = method === 'DELETE' ? `?workspaceId=${WORKSPACE_ID}&scope=workspace` : ''
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/v2/secrets/${SECRET_NAME}${query}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/secrets/[name]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    v2RouteMocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
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
