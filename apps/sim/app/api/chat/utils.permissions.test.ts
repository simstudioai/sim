/**
 * @vitest-environment node
 */

import { workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
