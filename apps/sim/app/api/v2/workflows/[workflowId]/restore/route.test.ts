/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ restoreWorkflow: vi.fn() }))

vi.mock('@/lib/workflows/application/restore-workflow', () => ({
  restoreWorkflow: { operation: { id: 'workflows.restore' }, execute: mocks.restoreWorkflow },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/workflows/[workflowId]/restore/route'

const WORKFLOW_ID = 'workflow-1'
const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const routeContext = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }
const url = `http://localhost/api/v2/workflows/${WORKFLOW_ID}/restore`

describe('/api/v2/workflows/[workflowId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.restoreWorkflow.mockResolvedValue({
      workflow: {
        id: WORKFLOW_ID,
        name: 'Daily digest',
        description: null,
        isDeployed: false,
        deployedAt: null,
        runCount: 0,
        lastRunAt: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
      workspaceId: 'workspace-1',
      folderPath: '/',
    })
  })

  it('authenticates before running the use case', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError('No API key'))

    const response = await POST(new NextRequest(url, { method: 'POST' }), routeContext)

    expect(response.status).toBe(401)
    expect(mocks.restoreWorkflow).not.toHaveBeenCalled()
  })

  it('returns the restored workflow summary', async () => {
    const response = await POST(new NextRequest(url, { method: 'POST' }), routeContext)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: WORKFLOW_ID,
        webUrl: `https://test.sim.ai/workspace/workspace-1/w/${WORKFLOW_ID}`,
        name: 'Daily digest',
        description: null,
        folderPath: '/',
        workspaceId: 'workspace-1',
        isDeployed: false,
        deployedAt: null,
        runCount: 0,
        lastRunAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    })
  })

  it('answers a workflow that is not archived with 409', async () => {
    mocks.restoreWorkflow.mockRejectedValue(
      new OrchestrationError('conflict', 'Workflow is not archived')
    )

    const response = await POST(new NextRequest(url, { method: 'POST' }), routeContext)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toEqual({
      code: 'CONFLICT',
      message: 'Workflow is not archived',
    })
  })

  it('conceals a cross-tenant restore as not found', async () => {
    mocks.restoreWorkflow.mockRejectedValue(new NoWorkspaceAccessError('workspace-2'))

    const response = await POST(new NextRequest(url, { method: 'POST' }), routeContext)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects an undeclared query param', async () => {
    const response = await POST(new NextRequest(`${url}?force=1`, { method: 'POST' }), routeContext)

    expect(response.status).toBe(400)
    expect(mocks.restoreWorkflow).not.toHaveBeenCalled()
  })
})
