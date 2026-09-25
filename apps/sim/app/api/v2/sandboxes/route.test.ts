import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { v2ApiKeyAuthModuleMock, v2RouteMocks } from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
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

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { SandboxDependencyError } from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import { GET, POST } from '@/app/api/v2/sandboxes/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = createPersonalApiKeyPrincipal()
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
  return createMockRequest({
    method,
    url: `http://localhost:3000${url}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/sandboxes', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    rateLimiterMockFns.mockCheckRateLimitDirect.mockResolvedValue(RATE_LIMIT_OK)
    rateLimiterMockFns.mockCheckRateLimitDirectOrThrow.mockResolvedValue(RATE_LIMIT_OK)
    mocks.list.mockResolvedValue(listResult)
    mocks.create.mockResolvedValue({ sandbox })
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
