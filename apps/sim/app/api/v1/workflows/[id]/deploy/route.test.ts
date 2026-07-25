/**
 * @vitest-environment node
 *
 * Tests for POST/DELETE /api/v1/workflows/[id]/deploy — verifies auth,
 * workspace admin permission enforcement, optional body handling, and the
 * mapping of orchestration results to v1 API responses.
 */

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { createMockRequest, workflowAuthzMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateWorkspaceAccess,
  mockPerformFullDeploy,
  mockPerformFullUndeploy,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
  mockPerformFullUndeploy: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  ),
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performFullDeploy: mockPerformFullDeploy,
  performFullUndeploy: mockPerformFullUndeploy,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn().mockResolvedValue({}),
  createApiResponse: vi.fn((body: unknown) => ({ body, headers: {} })),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import { DELETE, POST } from '@/app/api/v1/workflows/[id]/deploy/route'

const WORKFLOW_ID = 'wf-1'
const WORKFLOW_RECORD = {
  id: WORKFLOW_ID,
  name: 'My Workflow',
  workspaceId: 'ws-1',
  isDeployed: true,
}

function makeContext(id = WORKFLOW_ID) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(method: string, body?: unknown) {
  return createMockRequest(
    method,
    body,
    {},
    `http://localhost:3000/api/v1/workflows/${WORKFLOW_ID}/deploy`
  )
}

describe('POST /api/v1/workflows/[id]/deploy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-06-12T00:00:00Z'),
      version: 4,
      warnings: undefined,
      activeDeployment: {
        deploymentVersionId: 'dv-4',
        version: 4,
        deployedAt: '2026-06-12T00:00:00.000Z',
      },
      latestDeploymentAttempt: {
        id: 'op-1',
        deploymentVersionId: 'dv-4',
        version: 4,
        action: 'deploy',
        status: 'active',
        readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
        requestedAt: '2026-06-12T00:00:00.000Z',
        activatedAt: '2026-06-12T00:00:00.000Z',
        error: null,
      },
    })
  })

  it('rejects unauthenticated requests', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: 'Invalid API key' })

    const response = await POST(makeRequest('POST'), makeContext())

    expect(response.status).toBe(401)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('returns 404 when the workflow does not exist', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(null)

    const response = await POST(makeRequest('POST'), makeContext())

    expect(response.status).toBe(404)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('masks missing admin permission as 404', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    const response = await POST(makeRequest('POST'), makeContext())

    expect(response.status).toBe(404)
    expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ allowed: true }),
      'user-1',
      'ws-1',
      'admin'
    )
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON body', async () => {
    const request = new NextRequest(
      new URL(`http://localhost:3000/api/v1/workflows/${WORKFLOW_ID}/deploy`),
      {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: '{"name": "Release 4"',
      }
    )

    const response = await POST(request, makeContext())

    expect(response.status).toBe(400)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('rejects invalid version metadata', async () => {
    const response = await POST(makeRequest('POST', { name: '' }), makeContext())

    expect(response.status).toBe(400)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('deploys without a request body', async () => {
    const response = await POST(makeRequest('POST'), makeContext())

    expect(response.status).toBe(200)
    expect(mockPerformFullDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_ID,
        userId: 'user-1',
        versionName: undefined,
        versionDescription: undefined,
      })
    )

    const body = await response.json()
    expect(body.data).toEqual({
      id: WORKFLOW_ID,
      isDeployed: true,
      deployedAt: '2026-06-12T00:00:00.000Z',
      version: 4,
      warnings: [],
      activeDeployment: expect.objectContaining({ deploymentVersionId: 'dv-4', version: 4 }),
      latestDeploymentAttempt: expect.objectContaining({ id: 'op-1', status: 'active' }),
    })
  })

  it('passes version metadata through to the deploy orchestration', async () => {
    const response = await POST(
      makeRequest('POST', { name: 'Release 4', description: 'Fixes the agent prompt' }),
      makeContext()
    )

    expect(response.status).toBe(200)
    expect(mockPerformFullDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        versionName: 'Release 4',
        versionDescription: 'Fixes the agent prompt',
      })
    )
    /**
     * The workflow_deployed analytics event is emitted by the activation
     * side effects in the deployment outbox, not by this route.
     */
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('maps validation failures from the orchestration to 400', async () => {
    mockPerformFullDeploy.mockResolvedValue({
      success: false,
      error: 'Invalid schedule configuration',
      errorCode: 'validation',
    })

    const response = await POST(makeRequest('POST'), makeContext())

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid schedule configuration')
  })

  it('returns 423 when the workflow is locked', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(new WorkflowLockedError())

    const response = await POST(makeRequest('POST'), makeContext())

    expect(response.status).toBe(423)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/workflows/[id]/deploy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockPerformFullUndeploy.mockResolvedValue({ success: true })
  })

  it('returns 400 when the workflow is not deployed', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue({
      ...WORKFLOW_RECORD,
      isDeployed: false,
    })

    const response = await DELETE(makeRequest('DELETE'), makeContext())

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Workflow is not deployed')
    expect(mockPerformFullUndeploy).not.toHaveBeenCalled()
  })

  it('undeploys a deployed workflow', async () => {
    const response = await DELETE(makeRequest('DELETE'), makeContext())

    expect(response.status).toBe(200)
    expect(mockPerformFullUndeploy).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: WORKFLOW_ID, userId: 'user-1' })
    )

    const body = await response.json()
    expect(body.data).toEqual({
      id: WORKFLOW_ID,
      isDeployed: false,
      deployedAt: null,
      warnings: [],
    })
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'workflow_undeployed',
      expect.objectContaining({ workflow_id: WORKFLOW_ID }),
      expect.anything()
    )
  })

  it('masks missing admin permission as 404', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    const response = await DELETE(makeRequest('DELETE'), makeContext())

    expect(response.status).toBe(404)
    expect(mockPerformFullUndeploy).not.toHaveBeenCalled()
  })
})
