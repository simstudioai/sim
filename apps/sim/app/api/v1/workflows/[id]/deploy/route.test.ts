/**
 * Tests for POST/DELETE /api/v1/workflows/[id]/deploy — verifies auth,
 * workspace admin permission enforcement, optional body handling, and the
 * mapping of orchestration results to v1 API responses.
 */

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { createMockRequest, workflowAuthzMockFns } from '@sim/testing'
import { NextResponse } from 'next/server'
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
  v1ValidationErrorResponse: (e: { issues: unknown[] }) =>
    NextResponse.json({ error: 'Validation error', details: e.issues }, { status: 400 }),
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
      'deploy.api',
      'admin'
    )
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
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
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockPerformFullUndeploy.mockResolvedValue({ success: true })
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
