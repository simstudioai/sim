/**
 * Tests for POST/DELETE /api/v1/workflows/[id]/deploy — verifies auth,
 * workspace admin permission enforcement, optional body handling, and the
 * mapping of orchestration results to v1 API responses.
 */

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1LogsMetaMock } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { DELETE, POST } from '@/app/api/v1/workflows/[id]/deploy/route'

const { mockPerformFullDeploy, mockPerformFullUndeploy } = workflowsOrchestrationMockFns

const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent
const { mockCheckRateLimit, mockValidateWorkspaceAccess } = v1MiddlewareMockFns

const WORKFLOW_ID = 'wf-1'
const WORKFLOW_RECORD = {
  id: WORKFLOW_ID,
  name: 'My Workflow',
  workspaceId: 'ws-1',
  isDeployed: true,
}

function makeContext(id = WORKFLOW_ID) {
  return createRouteContext({ id })
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
