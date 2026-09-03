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
  getWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.read' }, execute: mocks.get },
  updateWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.update' }, execute: mocks.update },
  deleteWorkspaceSandboxUseCase: { operation: { id: 'sandboxes.delete' }, execute: mocks.remove },
}))

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, GET, PATCH } from '@/app/api/v2/sandboxes/[sandboxId]/route'

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
  systemPackages: [],
  buildStatus: 'failed',
  errorCode: 'install_failed',
  errorMessage: 'pip could not resolve pandas==99',
  errorDetail: 'ERROR: No matching distribution found for pandas==99',
  builtAt: null,
  createdAt: '2026-08-04T11:00:00.000Z',
  updatedAt: '2026-08-04T12:00:00.000Z',
}
const context = { params: Promise.resolve({ sandboxId: sandbox.id }) }

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body, and sending the query copy on a write
 * is a 400 rather than a silently dropped key.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown, query?: string) {
  const search = query ?? (method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`)
  return new NextRequest(`http://localhost:3000/api/v2/sandboxes/${sandbox.id}${search}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/sandboxes/[sandboxId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.get.mockResolvedValue({ sandbox })
    mocks.update.mockResolvedValue({ sandbox })
    mocks.remove.mockResolvedValue({ sandbox })
  })

  it('gets a sandbox, build failure included, through its read operation', async () => {
    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual(sandbox)
    expect(mocks.get).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, sandboxId: sandbox.id },
      request: expect.anything(),
    })
  })

  it('requires the workspace scope on a read', async () => {
    const response = await GET(request('GET', undefined, ''), context)

    expect(response.status).toBe(400)
    expect(mocks.get).not.toHaveBeenCalled()
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

  it('keeps an in-workspace role refusal a 403 with its remedy', async () => {
    mocks.update.mockRejectedValue(new InsufficientWorkspacePermissionsError())

    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, name: 'renamed' }),
      context
    )

    expect(response.status).toBe(403)
    expect((await response.json()).error.details).toEqual({ code: 'INSUFFICIENT_WORKSPACE_ROLE' })
  })

  it('tells a workspace key to use a personal key on a write', async () => {
    mocks.remove.mockRejectedValue(new WorkspaceApiKeyAuthorizationError())

    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(403)
    expect((await response.json()).error.details).toEqual({
      code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED',
    })
  })

  it('updates with the sandbox id from the path and the v2 source', async () => {
    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, dependencies: ['pandas', 'numpy'] }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        sandboxId: sandbox.id,
        dependencies: ['pandas', 'numpy'],
        source: 'api',
      },
      request: expect.anything(),
    })
  })

  it('rejects an update that changes nothing before application execution', async () => {
    const response = await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID }), context)

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('projects a name collision as a conflict', async () => {
    mocks.update.mockRejectedValue(
      new OrchestrationError('conflict', 'A sandbox named "other" already exists in this workspace')
    )

    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, name: 'other' }),
      context
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('CONFLICT')
  })

  it('deletes and acknowledges with the identifier', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: sandbox.id, deleted: true } })
    expect(mocks.remove).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, sandboxId: sandbox.id, source: 'api' },
      request: expect.anything(),
    })
  })
})
