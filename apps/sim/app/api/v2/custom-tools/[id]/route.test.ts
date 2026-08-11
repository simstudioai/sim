/**
 * @vitest-environment node
 */
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
      gate: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
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
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  getWorkspaceCustomToolUseCase: { operation: { id: 'custom_tools.read' }, execute: mocks.get },
  updateWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.update' },
    execute: mocks.update,
  },
  deleteWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.delete' },
    execute: mocks.remove,
  },
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/custom-tools/[id]/route'

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
const tool = {
  id: 'tool-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  title: 'lookup_order',
  schema: {
    type: 'function',
    function: { name: 'lookup_order', parameters: { type: 'object', properties: {} } },
  },
  code: 'return { ok: true }',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const context = { params: Promise.resolve({ id: tool.id }) }

function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/v2/custom-tools/${tool.id}?workspaceId=${WORKSPACE_ID}`,
    {
      method,
      headers: {
        'x-api-key': 'key',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  )
}

describe('/api/v2/custom-tools/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.get.mockResolvedValue({ tool })
    mocks.update.mockResolvedValue({ tool })
    mocks.remove.mockResolvedValue({ tool })
  })

  it('gets a custom tool through its semantic read operation', async () => {
    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(mocks.get).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, toolId: tool.id },
      request: expect.anything(),
    })
  })

  it('updates a custom tool through its semantic update operation', async () => {
    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, code: 'return 2' }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, toolId: tool.id, code: 'return 2', source: 'api' },
      request: expect.anything(),
    })
  })

  it('deletes a custom tool through its semantic delete operation', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: tool.id, deleted: true } })
    expect(mocks.remove).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, toolId: tool.id, source: 'api' },
      request: expect.anything(),
    })
  })

  it('authenticates before validating an empty patch body', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await PATCH(request('PATCH', {}), context)

    expect(response.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('conceals cross-tenant access while preserving same-workspace role denials', async () => {
    mocks.get.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request('GET'), context)).status).toBe(404)

    mocks.update.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    expect(
      (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, code: 'return 2' }), context))
        .status
    ).toBe(403)
  })
})
