/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  createWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/workflows/application/create-workflow', () => ({
  createWorkflow: { operation: { id: 'workflows.create' }, execute: mocks.createWorkflow },
}))

vi.mock('@/lib/workflows/application/list-workflows', () => ({
  listWorkflows: { operation: { id: 'workflows.list' }, execute: mocks.listWorkflows },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkRateLimitDirect
    checkRateLimitDirectOrThrow = mocks.checkRateLimitDirectOrThrow
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

import { GET, POST } from '@/app/api/v2/workflows/route'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW = {
  id: 'workflow-1',
  name: 'Daily digest',
  description: null,
  folderId: null,
  folderPath: '/',
  workspaceId: WORKSPACE_ID,
  isDeployed: false,
  deployedAt: null,
  runCount: 3,
  lastRunAt: null,
  sortOrder: 0,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}

const workspaceAuth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'workspace-key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:workspace-key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const personalAuth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'personal-key-1',
  },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('/api/v2/workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(workspaceAuth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-01T01:00:00.000Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-01T01:00:00.000Z'),
    })
    mocks.listWorkflows.mockResolvedValue({
      workflows: [WORKFLOW],
      nextCursorKeys: null,
      sortBy: 'position',
      sortOrder: 'asc',
    })
    mocks.createWorkflow.mockResolvedValue({ workflow: WORKFLOW, folderPath: '/' })
  })

  it('authenticates and rate limits before parsing list input', async () => {
    const response = await GET(new NextRequest('http://localhost/api/v2/workflows'))

    expect(response.status).toBe(400)
    expect(mocks.authenticateV2ApiKey).toHaveBeenCalledOnce()
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledTimes(2)
    expect(mocks.listWorkflows).not.toHaveBeenCalled()
  })

  it('lists through the workspace principal and preserves rate headers', async () => {
    const request = new NextRequest(
      `http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}`,
      { headers: { 'x-api-key': 'secret' } }
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99')
    expect(await response.json()).toEqual({
      data: [
        {
          id: WORKFLOW.id,
          name: WORKFLOW.name,
          description: null,
          folderPath: '/',
          workspaceId: WORKSPACE_ID,
          isDeployed: false,
          deployedAt: null,
          runCount: 3,
          lastRunAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.listWorkflows).toHaveBeenCalledWith({
      principal: workspaceAuth.principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID, limit: 50 }),
      request,
    })
  })

  it('creates through a personal-key principal with the exact 201 contract', async () => {
    mocks.authenticateV2ApiKey.mockResolvedValue(personalAuth)
    const request = new NextRequest('http://localhost/api/v2/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: WORKFLOW.name }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe(WORKFLOW.id)
    expect(mocks.createWorkflow).toHaveBeenCalledWith({
      principal: personalAuth.principal,
      input: { workspaceId: WORKSPACE_ID, name: WORKFLOW.name },
      request,
    })
  })

  it('hides infrastructure failures behind the safe v2 500 envelope', async () => {
    mocks.listWorkflows.mockRejectedValue(new Error('database connection details'))
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
