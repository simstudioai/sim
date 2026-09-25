import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { v2ApiKeyAuthModuleMock, v2RouteMocks } from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
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
  getWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.read' }, execute: mocks.get },
  updateWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.update' }, execute: mocks.update },
  deleteWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.delete' }, execute: mocks.remove },
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/sandboxes/[sandboxId]/route'

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
  systemPackages: [],
  buildStatus: 'failed',
  errorCode: 'install_failed',
  errorMessage: 'pip could not resolve pandas==99',
  errorDetail: 'ERROR: No matching distribution found for pandas==99',
  builtAt: null,
  createdAt: '2026-08-04T11:00:00.000Z',
  updatedAt: '2026-08-04T12:00:00.000Z',
}
const context = createRouteContext({ sandboxId: sandbox.id })

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body, and sending the query copy on a write
 * is a 400 rather than a silently dropped key.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown, query?: string) {
  const search = query ?? (method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`)
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/v2/sandboxes/${sandbox.id}${search}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/sandboxes/[sandboxId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    rateLimiterMockFns.mockCheckRateLimitDirect.mockResolvedValue(RATE_LIMIT_OK)
    rateLimiterMockFns.mockCheckRateLimitDirectOrThrow.mockResolvedValue(RATE_LIMIT_OK)
    mocks.get.mockResolvedValue({ sandbox })
    mocks.update.mockResolvedValue({ sandbox })
    mocks.remove.mockResolvedValue({ sandbox })
  })

  it('conceals a sandbox the caller has no reach into as missing', async () => {
    mocks.get.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error).toEqual({
      code: 'NOT_FOUND',
      message: 'Sandbox not found',
    })
  })

  it('answers a missing workspace as a missing sandbox, not as a missing workspace', async () => {
    mocks.get.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error).toEqual({
      code: 'NOT_FOUND',
      message: 'Sandbox not found',
    })
  })
})
