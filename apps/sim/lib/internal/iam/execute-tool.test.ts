/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeIamAddUserToGroup: vi.fn(),
  executeIamAttachRolePolicy: vi.fn(),
  executeIamAttachUserPolicy: vi.fn(),
  executeIamCreateAccessKey: vi.fn(),
  executeIamCreateRole: vi.fn(),
  executeIamCreateUser: vi.fn(),
  executeIamDeleteAccessKey: vi.fn(),
  executeIamDeleteRole: vi.fn(),
  executeIamDeleteUser: vi.fn(),
  executeIamDetachRolePolicy: vi.fn(),
  executeIamDetachUserPolicy: vi.fn(),
  executeIamGetRole: vi.fn(),
  executeIamGetUser: vi.fn(),
  executeIamListAttachedRolePolicies: vi.fn(),
  executeIamListAttachedUserPolicies: vi.fn(),
  executeIamListGroups: vi.fn(),
  executeIamListPolicies: vi.fn(),
  executeIamListRoles: vi.fn(),
  executeIamListUsers: vi.fn(),
  executeIamRemoveUserFromGroup: vi.fn(),
  executeIamSimulatePrincipalPolicy: vi.fn(),
}))

vi.mock('@/lib/internal/iam/operations', () => mockOperations)

import { executeIamTool } from '@/lib/internal/iam/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'iam_list_users',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  {
    toolId: 'iam_add_user_to_group',
    input: { ...CONNECTION, userName: 'test-user', groupName: 'test-group' },
    operation: mockOperations.executeIamAddUserToGroup,
  },
  {
    toolId: 'iam_attach_role_policy',
    input: { ...CONNECTION, roleName: 'test-role', policyArn: 'arn:aws:iam::aws:policy/Test' },
    operation: mockOperations.executeIamAttachRolePolicy,
  },
  {
    toolId: 'iam_attach_user_policy',
    input: { ...CONNECTION, userName: 'test-user', policyArn: 'arn:aws:iam::aws:policy/Test' },
    operation: mockOperations.executeIamAttachUserPolicy,
  },
  {
    toolId: 'iam_create_access_key',
    input: { ...CONNECTION, userName: 'test-user' },
    operation: mockOperations.executeIamCreateAccessKey,
  },
  {
    toolId: 'iam_create_role',
    input: {
      ...CONNECTION,
      roleName: 'test-role',
      assumeRolePolicyDocument: '{"Version":"2012-10-17"}',
    },
    operation: mockOperations.executeIamCreateRole,
  },
  {
    toolId: 'iam_create_user',
    input: { ...CONNECTION, userName: 'test-user' },
    operation: mockOperations.executeIamCreateUser,
  },
  {
    toolId: 'iam_delete_access_key',
    input: { ...CONNECTION, accessKeyIdToDelete: 'AKIADELETE' },
    operation: mockOperations.executeIamDeleteAccessKey,
  },
  {
    toolId: 'iam_delete_role',
    input: { ...CONNECTION, roleName: 'test-role' },
    operation: mockOperations.executeIamDeleteRole,
  },
  {
    toolId: 'iam_delete_user',
    input: { ...CONNECTION, userName: 'test-user' },
    operation: mockOperations.executeIamDeleteUser,
  },
  {
    toolId: 'iam_detach_role_policy',
    input: { ...CONNECTION, roleName: 'test-role', policyArn: 'arn:aws:iam::aws:policy/Test' },
    operation: mockOperations.executeIamDetachRolePolicy,
  },
  {
    toolId: 'iam_detach_user_policy',
    input: { ...CONNECTION, userName: 'test-user', policyArn: 'arn:aws:iam::aws:policy/Test' },
    operation: mockOperations.executeIamDetachUserPolicy,
  },
  {
    toolId: 'iam_get_role',
    input: { ...CONNECTION, roleName: 'test-role' },
    operation: mockOperations.executeIamGetRole,
  },
  {
    toolId: 'iam_get_user',
    input: { ...CONNECTION, userName: 'test-user' },
    operation: mockOperations.executeIamGetUser,
  },
  {
    toolId: 'iam_list_attached_role_policies',
    input: { ...CONNECTION, roleName: 'test-role' },
    operation: mockOperations.executeIamListAttachedRolePolicies,
  },
  {
    toolId: 'iam_list_attached_user_policies',
    input: { ...CONNECTION, userName: 'test-user' },
    operation: mockOperations.executeIamListAttachedUserPolicies,
  },
  {
    toolId: 'iam_list_groups',
    input: CONNECTION,
    operation: mockOperations.executeIamListGroups,
  },
  {
    toolId: 'iam_list_policies',
    input: CONNECTION,
    operation: mockOperations.executeIamListPolicies,
  },
  {
    toolId: 'iam_list_roles',
    input: CONNECTION,
    operation: mockOperations.executeIamListRoles,
  },
  {
    toolId: 'iam_list_users',
    input: CONNECTION,
    operation: mockOperations.executeIamListUsers,
  },
  {
    toolId: 'iam_remove_user_from_group',
    input: { ...CONNECTION, userName: 'test-user', groupName: 'test-group' },
    operation: mockOperations.executeIamRemoveUserFromGroup,
  },
  {
    toolId: 'iam_simulate_principal_policy',
    input: {
      ...CONNECTION,
      policySourceArn: 'arn:aws:iam::123456789012:user/test-user',
      actionNames: 's3:GetObject',
    },
    operation: mockOperations.executeIamSimulatePrincipalPolicy,
  },
] as const

describe('executeIamTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches $toolId', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeIamTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeIamTool(createRequest({ input: { region: 'invalid' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeIamListUsers).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope', async () => {
    mockOperations.executeIamListUsers.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeIamTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to list IAM users: AWS rejected credentials',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeIamTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeIamListUsers).not.toHaveBeenCalled()
  })
})
