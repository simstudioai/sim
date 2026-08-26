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

const mocks = vi.hoisted(() => ({ duplicateWorkflow: vi.fn() }))

vi.mock('@/lib/workflows/application/duplicate-workflow', () => ({
  duplicateWorkflow: {
    operation: { id: 'workflows.duplicate' },
    execute: mocks.duplicateWorkflow,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { POST } from '@/app/api/v2/workflows/[workflowId]/duplicate/route'

const WORKFLOW_ID = 'workflow-1'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'ws-key-1' },
  rateLimitSubjectIds: ['api-key:ws-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const routeContext = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/workflows/[workflowId]/duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.duplicateWorkflow.mockResolvedValue({
      id: 'workflow-2',
      name: 'Daily digest (copy)',
      description: null,
      workspaceId: 'workspace-1',
      folderId: null,
      folderPath: '/Operations',
      sortOrder: 0,
      locked: false,
      blocksCount: 3,
      edgesCount: 2,
      subflowsCount: 0,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  it('authenticates before parsing the body', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError('No API key'))

    const response = await POST(request({ nonsense: true }), routeContext)

    expect(response.status).toBe(401)
    expect(mocks.duplicateWorkflow).not.toHaveBeenCalled()
  })

  it('creates the copy with the workflow summary contract', async () => {
    const response = await POST(request({ folderPath: '/Operations' }), routeContext)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      data: {
        id: 'workflow-2',
        webUrl: 'https://test.sim.ai/workspace/workspace-1/w/workflow-2',
        name: 'Daily digest (copy)',
        description: null,
        folderPath: '/Operations',
        workspaceId: 'workspace-1',
        isDeployed: false,
        deployedAt: null,
        runCount: 0,
        lastRunAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    })
    expect(mocks.duplicateWorkflow).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { sourceWorkflowId: WORKFLOW_ID, name: undefined, folderPath: '/Operations' },
      request: expect.anything(),
    })
  })

  it('accepts an empty body and lets the use case default the name', async () => {
    const response = await POST(request({}), routeContext)

    expect(response.status).toBe(201)
    expect(mocks.duplicateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { sourceWorkflowId: WORKFLOW_ID, name: undefined, folderPath: undefined },
      })
    )
  })

  it('rejects an unknown body member', async () => {
    const response = await POST(request({ folderId: 'folder-1' }), routeContext)

    expect(response.status).toBe(400)
    expect(mocks.duplicateWorkflow).not.toHaveBeenCalled()
  })

  it('conceals a cross-tenant duplicate as not found', async () => {
    mocks.duplicateWorkflow.mockRejectedValue(new NoWorkspaceAccessError('workspace-2'))

    const response = await POST(request({}), routeContext)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})
