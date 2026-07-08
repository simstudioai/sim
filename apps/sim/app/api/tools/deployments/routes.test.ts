/**
 * @vitest-environment node
 *
 * Tests for the deployment tool routes under /api/tools/deployments — verifies
 * session/internal auth, workspace permission enforcement, and the mapping of
 * orchestration results to tool responses.
 */

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { createMockRequest, hybridAuthMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnforceUserRateLimit,
  mockPerformFullDeploy,
  mockPerformFullUndeploy,
  mockPerformActivateVersion,
  mockListWorkflowVersions,
  mockGetWorkflowDeploymentVersion,
} = vi.hoisted(() => ({
  mockEnforceUserRateLimit: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
  mockPerformFullUndeploy: vi.fn(),
  mockPerformActivateVersion: vi.fn(),
  mockListWorkflowVersions: vi.fn(),
  mockGetWorkflowDeploymentVersion: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performFullDeploy: mockPerformFullDeploy,
  performFullUndeploy: mockPerformFullUndeploy,
  performActivateVersion: mockPerformActivateVersion,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  listWorkflowVersions: mockListWorkflowVersions,
  getWorkflowDeploymentVersion: mockGetWorkflowDeploymentVersion,
}))

import { POST as deployPost } from '@/app/api/tools/deployments/deploy/route'
import { POST as promotePost } from '@/app/api/tools/deployments/promote/route'
import { POST as undeployPost } from '@/app/api/tools/deployments/undeploy/route'
import { GET as getVersionGet } from '@/app/api/tools/deployments/version/route'
import { GET as listVersionsGet } from '@/app/api/tools/deployments/versions/route'

const WORKFLOW_ID = 'wf-1'
const WORKFLOW_RECORD = {
  id: WORKFLOW_ID,
  name: 'My Workflow',
  workspaceId: 'ws-1',
  isDeployed: true,
}

function authorized() {
  return { allowed: true, status: 200, workflow: WORKFLOW_RECORD, workspacePermission: 'admin' }
}

function makePost(path: string, body: unknown) {
  return createMockRequest('POST', body, {}, `http://localhost:3000/api/tools/deployments/${path}`)
}

function makeGet(path: string, query: string) {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/tools/deployments/${path}?${query}`
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockEnforceUserRateLimit.mockResolvedValue(null)
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue(authorized())
  workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
})

describe('POST /api/tools/deployments/deploy', () => {
  beforeEach(() => {
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-06-12T00:00:00Z'),
      version: 4,
    })
  })

  it('rejects unauthenticated requests', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await deployPost(
      makePost('deploy', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1' })
    )

    expect(response.status).toBe(401)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('requires admin permission on the workflow workspace', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: WORKFLOW_RECORD,
      workspacePermission: 'write',
    })

    const response = await deployPost(
      makePost('deploy', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1' })
    )

    expect(response.status).toBe(403)
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      userId: 'user-1',
      action: 'admin',
    })
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('deploys and returns the new version', async () => {
    const response = await deployPost(
      makePost('deploy', {
        workflowId: WORKFLOW_ID,
        workspaceId: 'ws-1',
        name: 'Release 4',
        description: 'Fixes the agent prompt',
      })
    )

    expect(response.status).toBe(200)
    expect(mockPerformFullDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_ID,
        userId: 'user-1',
        versionName: 'Release 4',
        versionDescription: 'Fixes the agent prompt',
      })
    )

    const body = await response.json()
    expect(body).toEqual({
      success: true,
      output: {
        workflowId: WORKFLOW_ID,
        isDeployed: true,
        deployedAt: '2026-06-12T00:00:00.000Z',
        version: 4,
        warnings: [],
      },
    })
  })

  it('returns 423 when the workflow is locked', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(new WorkflowLockedError())

    const response = await deployPost(
      makePost('deploy', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1' })
    )

    expect(response.status).toBe(423)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('rejects a request without a workflowId', async () => {
    const response = await deployPost(makePost('deploy', { workspaceId: 'ws-1' }))

    expect(response.status).toBe(400)
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })

  it('returns 404 when the workflow belongs to a different workspace', async () => {
    const response = await deployPost(
      makePost('deploy', { workflowId: WORKFLOW_ID, workspaceId: 'ws-other' })
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Workflow not found in this workspace')
    expect(mockPerformFullDeploy).not.toHaveBeenCalled()
  })
})

describe('POST /api/tools/deployments/undeploy', () => {
  beforeEach(() => {
    mockPerformFullUndeploy.mockResolvedValue({ success: true })
  })

  it('returns 400 when the workflow is not deployed', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      ...authorized(),
      workflow: { ...WORKFLOW_RECORD, isDeployed: false },
    })

    const response = await undeployPost(
      makePost('undeploy', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1' })
    )

    expect(response.status).toBe(400)
    expect(mockPerformFullUndeploy).not.toHaveBeenCalled()
  })

  it('undeploys a deployed workflow', async () => {
    const response = await undeployPost(
      makePost('undeploy', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1' })
    )

    expect(response.status).toBe(200)
    expect(mockPerformFullUndeploy).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: WORKFLOW_ID, userId: 'user-1' })
    )

    const body = await response.json()
    expect(body.output).toEqual({
      workflowId: WORKFLOW_ID,
      isDeployed: false,
      deployedAt: null,
      warnings: [],
    })
  })
})

describe('POST /api/tools/deployments/promote', () => {
  beforeEach(() => {
    mockPerformActivateVersion.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-06-12T00:00:00Z'),
    })
  })

  it('promotes the given version to live', async () => {
    const response = await promotePost(
      makePost('promote', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1', version: 3 })
    )

    expect(response.status).toBe(200)
    expect(mockPerformActivateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: WORKFLOW_ID, version: 3, userId: 'user-1' })
    )

    const body = await response.json()
    expect(body.output).toEqual({
      workflowId: WORKFLOW_ID,
      isDeployed: true,
      deployedAt: '2026-06-12T00:00:00.000Z',
      version: 3,
      warnings: [],
    })
  })

  it('rejects a missing version', async () => {
    const response = await promotePost(
      makePost('promote', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1' })
    )

    expect(response.status).toBe(400)
    expect(mockPerformActivateVersion).not.toHaveBeenCalled()
  })

  it('maps a missing target version to 404', async () => {
    mockPerformActivateVersion.mockResolvedValue({
      success: false,
      error: 'Deployment version not found',
      errorCode: 'not_found',
    })

    const response = await promotePost(
      makePost('promote', { workflowId: WORKFLOW_ID, workspaceId: 'ws-1', version: 99 })
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/tools/deployments/versions', () => {
  it('lists deployment versions with read permission', async () => {
    const versions = [
      {
        id: 'v-2',
        version: 2,
        name: null,
        description: null,
        isActive: true,
        createdAt: '2026-06-12T00:00:00.000Z',
        createdBy: 'user-1',
        deployedByName: 'Waleed',
      },
    ]
    mockListWorkflowVersions.mockResolvedValue({ versions })

    const response = await listVersionsGet(
      makeGet('versions', `workflowId=${WORKFLOW_ID}&workspaceId=ws-1`)
    )

    expect(response.status).toBe(200)
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      userId: 'user-1',
      action: 'read',
    })

    const body = await response.json()
    expect(body.output).toEqual({ workflowId: WORKFLOW_ID, versions })
  })
})

describe('GET /api/tools/deployments/version', () => {
  it('returns version metadata and the deployed state', async () => {
    mockGetWorkflowDeploymentVersion.mockResolvedValue({
      id: 'v-3',
      version: 3,
      name: 'Release 3',
      description: null,
      isActive: false,
      createdAt: '2026-06-12T00:00:00.000Z',
      state: { blocks: {}, edges: [] },
    })

    const response = await getVersionGet(
      makeGet('version', `workflowId=${WORKFLOW_ID}&workspaceId=ws-1&version=3`)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.output).toEqual({
      workflowId: WORKFLOW_ID,
      version: 3,
      name: 'Release 3',
      description: null,
      isActive: false,
      createdAt: '2026-06-12T00:00:00.000Z',
      deployedState: { blocks: {}, edges: [] },
    })
  })

  it('returns 404 when the version does not exist', async () => {
    mockGetWorkflowDeploymentVersion.mockResolvedValue(null)

    const response = await getVersionGet(
      makeGet('version', `workflowId=${WORKFLOW_ID}&workspaceId=ws-1&version=9`)
    )

    expect(response.status).toBe(404)
  })
})
