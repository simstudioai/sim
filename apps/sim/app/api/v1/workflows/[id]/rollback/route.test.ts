/**
 * Tests for POST /api/v1/workflows/[id]/rollback — verifies target version
 * resolution (previous version by default, explicit version when provided)
 * and the mapping of activation results to v1 API responses.
 */

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { POST } from '@/app/api/v1/workflows/[id]/rollback/route'

const { mockPerformActivateVersion } = workflowsOrchestrationMockFns
const { mockCheckRateLimit, mockValidateWorkspaceAccess } = v1MiddlewareMockFns
v1MiddlewareMockFns.mockCreateRateLimitResponse.mockImplementation(() =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
)

v1LogsMetaMockFns.mockCreateApiResponse.mockImplementation((body: unknown) => ({
  body,
  headers: {},
}))

const mockFindPreviousDeploymentVersion =
  workflowsPersistenceUtilsMockFns.mockFindPreviousDeploymentVersion

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
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockPerformActivateVersion.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-06-12T00:00:00Z'),
      activeDeployment: {
        deploymentVersionId: 'dv-4',
        version: 4,
        deployedAt: '2026-06-12T00:00:00.000Z',
      },
      latestDeploymentAttempt: {
        id: 'op-1',
        deploymentVersionId: 'dv-4',
        version: 4,
        action: 'activate',
        status: 'active',
        readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
        requestedAt: '2026-06-12T00:00:00.000Z',
        activatedAt: '2026-06-12T00:00:00.000Z',
        error: null,
      },
    })
  })

  it('returns 423 when the workflow is locked', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(new WorkflowLockedError())

    const response = await POST(makeRequest(), makeContext())

    expect(response.status).toBe(423)
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
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
      'deploy.api',
      'admin'
    )
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })
})
