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
  listWorkspaceCustomToolsUseCase: {
    operation: { id: 'custom_tools.list' },
    execute: mocks.list,
  },
  createWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.create' },
    execute: mocks.create,
  },
}))

import { GET, POST } from '@/app/api/v2/custom-tools/route'

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
const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'lookup_order',
    parameters: { type: 'object', properties: {} },
  },
}
const tool = {
  id: 'tool-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  title: 'lookup_order',
  schema: TOOL_SCHEMA,
  code: 'return { ok: true }',
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

describe('/api/v2/custom-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.list.mockResolvedValue({ tools: [tool] })
    mocks.create.mockResolvedValue({ tool })
  })

  it('lists custom tools through the authorized application use case', async () => {
    const response = await GET(request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect((await response.json()).data[0]).toMatchObject({ id: 'tool-1', title: 'lookup_order' })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      request: expect.anything(),
    })
    expect(mocks.operationRate).toHaveBeenCalledWith(
      'v2:custom_tools.list:workspace:workspace-1',
      expect.objectContaining({ maxTokens: 100 })
    )
  })

  it('creates exactly one custom tool with the v2 source and status', async () => {
    const response = await POST(
      request('POST', '/api/v2/custom-tools', {
        workspaceId: WORKSPACE_ID,
        title: tool.title,
        schema: TOOL_SCHEMA,
        code: tool.code,
      })
    )

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe('tool-1')
    expect(mocks.create).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        title: tool.title,
        schema: TOOL_SCHEMA,
        code: tool.code,
        source: 'api',
      },
      request: expect.anything(),
    })
  })

  it('authenticates before validating a malformed create body', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(request('POST', '/api/v2/custom-tools', {}))

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects invalid list sort fields before application execution', async () => {
    const response = await GET(
      request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}&sortBy=invalid`)
    )

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
