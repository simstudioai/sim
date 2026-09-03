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
  enforceUserRateLimit: vi.fn(),
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
vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', async () => {
  const { OrchestrationError } = await import('@/lib/core/orchestration/types')
  class SandboxDependencyError extends OrchestrationError {
    constructor(readonly issues: { line: number; value: string; reason: string }[]) {
      super('validation', issues[0]?.reason ?? 'Invalid dependency list')
    }
  }
  class SandboxSystemPackageError extends OrchestrationError {
    constructor(readonly issues: { line: number; value: string; reason: string }[]) {
      super('validation', issues[0]?.reason ?? 'Invalid system package list')
    }
  }
  return {
    SANDBOX_MUTATION_LIMIT: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
    SandboxDependencyError,
    SandboxSystemPackageError,
  }
})
vi.mock('@/lib/sandboxes/application/use-cases', () => ({
  listWorkspaceSandboxesUseCase: { operation: { id: 'sandboxes.list' }, execute: mocks.list },
  createWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.create' }, execute: mocks.create },
}))

import { V2_DEFAULT_PAGE_SIZE } from '@/lib/api/contracts/v2/shared'
import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { ForbiddenOperationError } from '@/lib/core/application'
import { SandboxDependencyError } from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import { GET, POST } from '@/app/api/v2/sandboxes/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
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
const sandbox = {
  id: 'sandbox-1',
  name: 'data-tools',
  language: 'python',
  dependencies: ['pandas'],
  cliTools: [],
  systemPackages: ['graphviz'],
  buildStatus: 'ready',
  errorCode: null,
  errorMessage: null,
  errorDetail: null,
  builtAt: '2026-08-04T12:00:00.000Z',
  createdAt: '2026-08-04T11:00:00.000Z',
  updatedAt: '2026-08-04T12:00:00.000Z',
}
const listResult = {
  sandboxes: [sandbox],
  nextCursorKeys: null,
  strategy: 'prebuilt',
  entitled: true,
  sortBy: 'name',
  sortOrder: 'asc',
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

describe('/api/v2/sandboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.list.mockResolvedValue(listResult)
    mocks.create.mockResolvedValue({ sandbox })
  })

  it('lists sandboxes through the authorized application use case', async () => {
    const response = await GET(request('GET', `/api/v2/sandboxes?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [sandbox], nextCursor: null })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        search: undefined,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: V2_DEFAULT_PAGE_SIZE,
        cursorKeys: undefined,
      },
      request: expect.anything(),
    })
    expect(mocks.operationRate).toHaveBeenCalledWith(
      'v2:sandboxes.list:user:user-1',
      expect.objectContaining({ maxTokens: 100 })
    )
  })

  it('refuses a cursor minted under a different filter', async () => {
    mocks.list.mockResolvedValue({ ...listResult, nextCursorKeys: ['data-tools', 'sandbox-1'] })

    const minted = await GET(
      request('GET', `/api/v2/sandboxes?workspaceId=${WORKSPACE_ID}&search=data`)
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await GET(
      request(
        'GET',
        `/api/v2/sandboxes?workspaceId=${WORKSPACE_ID}&search=tools&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mocks.list.mockResolvedValue({ ...listResult, nextCursorKeys: ['data-tools', 'sandbox-1'] })

    const minted = await GET(
      request('GET', `/api/v2/sandboxes?workspaceId=${WORKSPACE_ID}&search=data`)
    )
    const { nextCursor } = await minted.json()

    mocks.list.mockClear()
    const resumed = await GET(
      request(
        'GET',
        `/api/v2/sandboxes?workspaceId=${WORKSPACE_ID}&search=data&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        search: 'data',
        cursorKeys: ['data-tools', 'sandbox-1'],
      }),
      request: expect.anything(),
    })
  })

  it('rejects an unimplemented sort field before application execution', async () => {
    const response = await GET(
      request('GET', `/api/v2/sandboxes?workspaceId=${WORKSPACE_ID}&sortBy=buildStatus`)
    )

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('creates a sandbox with the v2 source, defaulted lists, and a 201', async () => {
    const response = await POST(
      request('POST', '/api/v2/sandboxes', {
        workspaceId: WORKSPACE_ID,
        name: 'data-tools',
        language: 'python',
        dependencies: ['pandas'],
      })
    )

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe('sandbox-1')
    expect(mocks.create).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: 'data-tools',
        language: 'python',
        dependencies: ['pandas'],
        cliTools: [],
        systemPackages: [],
        source: 'api',
      },
      request: expect.anything(),
    })
  })

  it('authenticates before validating a malformed create body', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(request('POST', '/api/v2/sandboxes', {}))

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('names the plan as the remedy for a workspace below the Max tier', async () => {
    mocks.create.mockRejectedValue(
      new ForbiddenOperationError(
        'WORKSPACE_PLAN_CAPABILITY_REQUIRED',
        'Sim sandboxes require an active Max or Enterprise plan.'
      )
    )

    const response = await POST(
      request('POST', '/api/v2/sandboxes', {
        workspaceId: WORKSPACE_ID,
        name: 'data-tools',
        language: 'python',
      })
    )

    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      code: 'FORBIDDEN',
      details: { code: 'WORKSPACE_PLAN_CAPABILITY_REQUIRED' },
    })
  })

  it('addresses a refused dependency entry to its field and row', async () => {
    const issue = { line: 2, value: 'not a package!', reason: 'invalid package name' }
    mocks.create.mockRejectedValue(new SandboxDependencyError([issue]))

    const response = await POST(
      request('POST', '/api/v2/sandboxes', {
        workspaceId: WORKSPACE_ID,
        name: 'data-tools',
        language: 'python',
        dependencies: ['pandas', 'not a package!'],
      })
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toEqual({
      code: 'BAD_REQUEST',
      message: 'invalid package name',
      details: { issueField: 'dependencies', issues: [issue] },
    })
  })

  it('answers a spent build budget with 429 and a Retry-After the caller can honor', async () => {
    mocks.create.mockRejectedValue(
      new SandboxBuildBudgetExceededError(new Date(Date.now() + 30_000), 30_000)
    )

    const response = await POST(
      request('POST', '/api/v2/sandboxes', {
        workspaceId: WORKSPACE_ID,
        name: 'data-tools',
        language: 'python',
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect((await response.json()).error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfter: expect.any(String) },
    })
  })
})
