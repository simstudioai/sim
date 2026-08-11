/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  readWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/workflows/application/read-workflow', () => ({
  readWorkflow: { operation: { id: 'workflows.read' }, execute: mocks.readWorkflow },
}))
vi.mock('@/lib/workflows/application/update-workflow', () => ({
  updateWorkflow: { operation: { id: 'workflows.update' }, execute: mocks.updateWorkflow },
}))
vi.mock('@/lib/workflows/application/delete-workflow', () => ({
  deleteWorkflow: { operation: { id: 'workflows.delete' }, execute: mocks.deleteWorkflow },
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

import { NoWorkspaceAccessError, PersonalApiKeysDisabledError } from '@/lib/core/application'
import { DELETE, GET, PATCH } from '@/app/api/v2/workflows/[id]/route'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'
const workflow = {
  id: WORKFLOW_ID,
  name: 'Daily digest',
  description: null,
  workspaceId: WORKSPACE_ID,
  folderId: null,
  variables: {},
  isDeployed: true,
  deployedAt: new Date('2026-08-03T00:00:00.000Z'),
  runCount: 4,
  lastRunAt: new Date('2026-08-04T00:00:00.000Z'),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}
const auth = {
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
const routeContext = { params: Promise.resolve({ id: WORKFLOW_ID }) }

describe('/api/v2/workflows/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(auth)
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
    mocks.readWorkflow.mockResolvedValue({
      workflow,
      workspaceId: WORKSPACE_ID,
      folderPath: '/',
      inputs: [],
    })
    mocks.updateWorkflow.mockResolvedValue({
      workflow: { ...workflow, name: 'Weekly digest' },
      workspaceId: WORKSPACE_ID,
      folderPath: '/',
      deployment: {
        isDeployed: true,
        deployedAt: workflow.deployedAt,
        runCount: 4,
        lastRunAt: workflow.lastRunAt,
      },
    })
    mocks.deleteWorkflow.mockResolvedValue({ workflowId: WORKFLOW_ID })
  })

  it('presents the authorized canonical workflow detail', async () => {
    const request = new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}`)
    const response = await GET(request, routeContext)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      id: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      folderPath: '/',
      inputs: [],
    })
    expect(mocks.readWorkflow).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workflowId: WORKFLOW_ID },
      request,
    })
  })

  it('conceals absent workspace access as workflow absence', async () => {
    mocks.readWorkflow.mockRejectedValue(new NoWorkspaceAccessError())
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}`),
      routeContext
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Workflow not found' },
    })
  })

  it('returns the personal-key-disabled policy failure as forbidden', async () => {
    mocks.readWorkflow.mockRejectedValue(new PersonalApiKeysDisabledError())
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}`),
      routeContext
    )

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  it('updates only through the shared semantic use case', async () => {
    const request = new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Weekly digest' }),
    })
    const response = await PATCH(request, routeContext)

    expect(response.status).toBe(200)
    expect((await response.json()).data.name).toBe('Weekly digest')
    expect(mocks.updateWorkflow).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workflowId: WORKFLOW_ID, name: 'Weekly digest' },
      request,
    })
  })

  it('deletes through the shared use case and preserves the response contract', async () => {
    const request = new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}`, {
      method: 'DELETE',
    })
    const response = await DELETE(request, routeContext)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: WORKFLOW_ID, deleted: true } })
    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workflowId: WORKFLOW_ID },
      request,
    })
  })
})
