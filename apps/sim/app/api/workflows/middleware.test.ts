/**
 * Tests for workflow access middleware — focused on the workspace-scoped
 * API key boundary check in the `requireDeployment=false` branch.
 *
 * @vitest-environment node
 */

import {
  hybridAuthMockFns,
  workflowAuthzMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)
vi.mock('@sim/workflow-authz', () => workflowAuthzMock)
vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: vi.fn(),
  updateApiKeyLastUsed: vi.fn(),
}))

import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

function makeRequest() {
  return new NextRequest(new URL('https://example.com/api/workflows/wf-1/log'))
}

describe('validateWorkflowAccess (requireDeployment=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowsUtilsMockFns.mockGetWorkflowById.mockResolvedValue({
      id: 'wf-1',
      workspaceId: 'ws-A',
      isDeployed: true,
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-A' },
    })
  })

  it('rejects a workspace-scoped API key issued for a different workspace', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
      workspaceId: 'ws-B',
    })

    const result = await validateWorkflowAccess(makeRequest(), 'wf-1', false)

    expect(result.error).toEqual({
      message: 'API key is not authorized for this workspace',
      status: 403,
    })
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
  })

  it('allows a workspace-scoped API key issued for the matching workspace', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
      workspaceId: 'ws-A',
    })

    const result = await validateWorkflowAccess(makeRequest(), 'wf-1', false)

    expect(result.error).toBeUndefined()
    expect(result.workflow).toBeDefined()
    expect(result.auth?.workspaceId).toBe('ws-A')
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'user-1',
      action: 'read',
    })
  })

  it('allows a personal API key regardless of workspaceId on the auth result', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
      workspaceId: 'ws-B',
    })

    const result = await validateWorkflowAccess(makeRequest(), 'wf-1', false)

    expect(result.error).toBeUndefined()
    expect(result.workflow).toBeDefined()
  })

  it('allows session auth (no apiKeyType) when workspace permission grants access', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })

    const result = await validateWorkflowAccess(makeRequest(), 'wf-1', false)

    expect(result.error).toBeUndefined()
    expect(result.workflow).toBeDefined()
  })

  it('still enforces workspace-permission rejection for personal keys', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'Access denied',
    })

    const result = await validateWorkflowAccess(makeRequest(), 'wf-1', false)

    expect(result.error).toEqual({ message: 'Access denied', status: 403 })
  })
})
