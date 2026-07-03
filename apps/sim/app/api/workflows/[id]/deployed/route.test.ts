/**
 * Tests for the workflow deployed-state API route.
 * Covers internal-JWT authorization (acting user required + workspace read
 * permission) and the unchanged session path.
 *
 * @vitest-environment node
 */

import {
  workflowAuthzMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyInternalToken } = vi.hoisted(() => ({
  mockVerifyInternalToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyInternalToken: mockVerifyInternalToken,
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { GET } from './route'

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState
const mockValidateWorkflowPermissions = workflowsUtilsMockFns.mockValidateWorkflowPermissions

const DEPLOYED_STATE = {
  blocks: { 'block-1': { id: 'block-1', type: 'starter' } },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
}

function createRequest(options?: { bearerToken?: string }) {
  const headers: Record<string, string> = {}
  if (options?.bearerToken) {
    headers.Authorization = `Bearer ${options.bearerToken}`
  }
  return new NextRequest('http://localhost:3000/api/workflows/workflow-123/deployed', { headers })
}

const routeParams = () => ({ params: Promise.resolve({ id: 'workflow-123' }) })

describe('GET /api/workflows/[id]/deployed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyInternalToken.mockResolvedValue({ valid: false })
    mockLoadDeployedWorkflowState.mockResolvedValue(DEPLOYED_STATE)
  })

  describe('internal JWT path', () => {
    it('returns 200 when the token carries a user with read permission', async () => {
      mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: 'user-123' })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: { id: 'workflow-123', workspaceId: 'workspace-456' },
        workspacePermission: 'read',
      })

      const response = await GET(createRequest({ bearerToken: 'internal-token' }), routeParams())

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.deployedState).toEqual(DEPLOYED_STATE)
      expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
        workflowId: 'workflow-123',
        userId: 'user-123',
        action: 'read',
      })
      expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
    })

    it('returns 403 when the acting user lacks read permission', async () => {
      mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: 'user-123' })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to read this workflow',
        workflow: { id: 'workflow-123', workspaceId: 'workspace-456' },
        workspacePermission: null,
      })

      const response = await GET(createRequest({ bearerToken: 'internal-token' }), routeParams())

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to read this workflow')
      expect(mockLoadDeployedWorkflowState).not.toHaveBeenCalled()
    })

    it('returns 403 when the token carries no acting user (fail closed)', async () => {
      mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: undefined })

      const response = await GET(createRequest({ bearerToken: 'internal-token' }), routeParams())

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Forbidden')
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
      expect(mockLoadDeployedWorkflowState).not.toHaveBeenCalled()
    })

    it('returns 404 when the workflow does not exist', async () => {
      mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: 'user-123' })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: null,
        workspacePermission: null,
      })

      const response = await GET(createRequest({ bearerToken: 'internal-token' }), routeParams())

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
      expect(mockLoadDeployedWorkflowState).not.toHaveBeenCalled()
    })
  })

  describe('session path', () => {
    it('returns 200 when session permissions validate', async () => {
      mockValidateWorkflowPermissions.mockResolvedValue({
        error: null,
        session: { user: { id: 'user-123' } },
        workflow: { id: 'workflow-123' },
      })

      const response = await GET(createRequest(), routeParams())

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.deployedState).toEqual(DEPLOYED_STATE)
      expect(mockValidateWorkflowPermissions).toHaveBeenCalledWith(
        'workflow-123',
        expect.any(String),
        'read'
      )
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    })

    it('propagates validateWorkflowPermissions errors unchanged', async () => {
      mockValidateWorkflowPermissions.mockResolvedValue({
        error: { message: 'Unauthorized', status: 401 },
        session: null,
        workflow: null,
      })

      const response = await GET(createRequest(), routeParams())

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('falls back to session validation when the bearer token is not a valid internal token', async () => {
      mockVerifyInternalToken.mockResolvedValue({ valid: false })
      mockValidateWorkflowPermissions.mockResolvedValue({
        error: { message: 'Unauthorized', status: 401 },
        session: null,
        workflow: null,
      })

      const response = await GET(createRequest({ bearerToken: 'not-internal' }), routeParams())

      expect(response.status).toBe(401)
      expect(mockValidateWorkflowPermissions).toHaveBeenCalled()
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    })
  })

  it('returns null deployedState when loading the snapshot fails', async () => {
    mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: 'user-123' })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-123', workspaceId: 'workspace-456' },
      workspacePermission: 'admin',
    })
    mockLoadDeployedWorkflowState.mockRejectedValue(new Error('no active deployment'))

    const response = await GET(createRequest({ bearerToken: 'internal-token' }), routeParams())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.deployedState).toBeNull()
  })
})
