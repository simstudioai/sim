/**
 * @vitest-environment node
 *
 * Tests for POST /api/v1/workflows/[id]/rollback — verifies target version
 * resolution (previous version by default, explicit version when provided)
 * and the mapping of activation results to v1 API responses.
 */

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { createMockRequest, workflowAuthzMockFns } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateWorkspaceAccess,
  mockPerformActivateVersion,
  mockFindPreviousDeploymentVersion,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockPerformActivateVersion: vi.fn(),
  mockFindPreviousDeploymentVersion: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  findPreviousDeploymentVersion: mockFindPreviousDeploymentVersion,
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  ),
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performActivateVersion: mockPerformActivateVersion,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn().mockResolvedValue({}),
  createApiResponse: vi.fn((body: unknown) => ({ body, headers: {} })),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { POST } from '@/app/api/v1/workflows/[id]/rollback/route'

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

function makeRequest(body?: unknown) {
  return createMockRequest(
    'POST',
    body,
    {},
    `http://localhost:3000/api/v1/workflows/${WORKFLOW_ID}/rollback`
  )
}

describe('POST /api/v1/workflows/[id]/rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockPerformActivateVersion.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-06-12T00:00:00Z'),
    })
  })

  it('rejects unauthenticated requests', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: 'Invalid API key' })

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(401)
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('returns 404 when the workflow does not exist', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(null)

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(404)
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('returns 423 when the workflow is locked', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(new WorkflowLockedError())

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(423)
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('rolls back to the previous version when no version is given', async () => {
    mockFindPreviousDeploymentVersion.mockResolvedValue({ ok: true, version: 4 })

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(200)
    expect(mockPerformActivateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: WORKFLOW_ID, version: 4, userId: 'user-1' })
    )

    const body = await response.json()
    expect(body.data).toEqual({
      id: WORKFLOW_ID,
      isDeployed: true,
      deployedAt: '2026-06-12T00:00:00.000Z',
      version: 4,
      warnings: [],
    })
  })

  it('returns 400 when the workflow is not deployed, even with an explicit version', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue({
      ...WORKFLOW_RECORD,
      isDeployed: false,
    })

    const response = await POST(makeRequest({ version: 2 }), makeContext())

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Workflow is not deployed')
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('rolls back to an explicit version when provided', async () => {
    const response = await POST(makeRequest({ version: 2 }), makeContext())

    expect(response.status).toBe(200)
    expect(mockPerformActivateVersion).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }))
    expect(mockFindPreviousDeploymentVersion).not.toHaveBeenCalled()
  })

  it('rejects a non-integer version', async () => {
    const response = await POST(makeRequest({ version: 1.5 }), makeContext())

    expect(response.status).toBe(400)
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('returns 400 when there is no active deployment to roll back from', async () => {
    mockFindPreviousDeploymentVersion.mockResolvedValue({ ok: false, reason: 'no_active_version' })

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Workflow has no active deployment to roll back from')
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('returns 400 when there is no previous version to roll back to', async () => {
    mockFindPreviousDeploymentVersion.mockResolvedValue({
      ok: false,
      reason: 'no_previous_version',
    })

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('No previous deployment version to roll back to')
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('maps a missing target version to 404', async () => {
    mockPerformActivateVersion.mockResolvedValue({
      success: false,
      error: 'Deployment version not found',
      errorCode: 'not_found',
    })

    const response = await POST(makeRequest({ version: 99 }), makeContext())

    expect(response.status).toBe(404)
  })

  it('masks missing admin permission as 404', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(404)
    expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ allowed: true }),
      'user-1',
      'ws-1',
      'admin'
    )
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })
})
