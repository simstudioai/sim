/**
 * @vitest-environment node
 */

import { workflowAuthzMockFns } from '@sim/testing'

const { mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canExposePublicly } from '@/lib/deployments/public-exposure'
import { checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'

/**
 * Chat deployment dropped from `admin` to `write` alongside the rest of the
 * deployment lifecycle. These helpers call `authorizeWorkflowByWorkspacePermission`
 * directly rather than going through the operation registry, so the central
 * permission-matrix test does not cover them — every consumer suite mocks
 * `checkChatAccess` wholesale, which leaves the required level unobserved.
 * These assert the level itself, so reverting it to `admin` fails here.
 */
describe('chat deployment permission level', () => {
  const WORKFLOW = { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creating a chat deployment requires write, not admin', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: WORKFLOW,
      workspacePermission: 'write',
    })

    const result = await checkWorkflowAccessForChatCreation('wf-1', 'user-1')

    expect(result.hasAccess).toBe(true)
    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'user-1',
      action: 'write',
    })
  })

  it('denies a member the authorizer rejects', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Insufficient permissions',
      workflow: WORKFLOW,
      workspacePermission: 'read',
    })

    const result = await checkWorkflowAccessForChatCreation('wf-1', 'user-1')

    expect(result.hasAccess).toBe(false)
    expect(result.workflow).toBeUndefined()
  })

  it('denies when the workflow does not resolve', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
    })

    const result = await checkWorkflowAccessForChatCreation('wf-1', 'user-1')

    expect(result.hasAccess).toBe(false)
  })
})

/**
 * A chat deployed with `authType: 'public'` is invocable by anyone with the URL
 * and no authentication — the same exposure as a public workflow API, which is
 * admin-only. Deploying an authenticated chat stays at `write`.
 */
describe('public chat auth is admin-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows an admin', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    await expect(canExposePublicly('user-1', 'ws-1')).resolves.toBe(true)
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user-1', 'workspace', 'ws-1')
  })

  it.each(['write', 'read'] as const)('refuses a %s member', async (permission) => {
    mockGetUserEntityPermissions.mockResolvedValue(permission)
    await expect(canExposePublicly('user-1', 'ws-1')).resolves.toBe(false)
  })

  it('refuses a member with no permission on the workspace', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    await expect(canExposePublicly('user-1', 'ws-1')).resolves.toBe(false)
  })
})
