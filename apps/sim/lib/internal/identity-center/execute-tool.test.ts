/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeIdentityCenterListInstances: vi.fn(),
  executeIdentityCenterListAccounts: vi.fn(),
  executeIdentityCenterDescribeAccount: vi.fn(),
  executeIdentityCenterListPermissionSets: vi.fn(),
  executeIdentityCenterGetUser: vi.fn(),
  executeIdentityCenterGetGroup: vi.fn(),
  executeIdentityCenterListGroups: vi.fn(),
  executeIdentityCenterCreateAccountAssignment: vi.fn(),
  executeIdentityCenterDeleteAccountAssignment: vi.fn(),
  executeIdentityCenterCheckAssignmentStatus: vi.fn(),
  executeIdentityCenterCheckAssignmentDeletionStatus: vi.fn(),
  executeIdentityCenterListAccountAssignments: vi.fn(),
}))

vi.mock('@/lib/internal/identity-center/operations', () => mockOperations)

import { executeIdentityCenterTool } from '@/lib/internal/identity-center/execute-tool'
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
    toolId: 'identity_center_list_instances',
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
    toolId: 'identity_center_list_instances',
    input: CONNECTION,
    operation: mockOperations.executeIdentityCenterListInstances,
  },
  {
    toolId: 'identity_center_list_accounts',
    input: CONNECTION,
    operation: mockOperations.executeIdentityCenterListAccounts,
  },
  {
    toolId: 'identity_center_describe_account',
    input: { ...CONNECTION, accountId: '123456789012' },
    operation: mockOperations.executeIdentityCenterDescribeAccount,
  },
  {
    toolId: 'identity_center_list_permission_sets',
    input: { ...CONNECTION, instanceArn: 'arn:aws:sso:::instance/ssoins-test' },
    operation: mockOperations.executeIdentityCenterListPermissionSets,
  },
  {
    toolId: 'identity_center_get_user',
    input: { ...CONNECTION, identityStoreId: 'd-test', email: 'user@example.com' },
    operation: mockOperations.executeIdentityCenterGetUser,
  },
  {
    toolId: 'identity_center_get_group',
    input: { ...CONNECTION, identityStoreId: 'd-test', displayName: 'Engineering' },
    operation: mockOperations.executeIdentityCenterGetGroup,
  },
  {
    toolId: 'identity_center_list_groups',
    input: { ...CONNECTION, identityStoreId: 'd-test' },
    operation: mockOperations.executeIdentityCenterListGroups,
  },
  {
    toolId: 'identity_center_create_account_assignment',
    input: {
      ...CONNECTION,
      instanceArn: 'arn:aws:sso:::instance/ssoins-test',
      accountId: '123456789012',
      permissionSetArn: 'arn:aws:sso:::permissionSet/ssoins-test/ps-test',
      principalType: 'USER',
      principalId: 'user-1',
    },
    operation: mockOperations.executeIdentityCenterCreateAccountAssignment,
  },
  {
    toolId: 'identity_center_delete_account_assignment',
    input: {
      ...CONNECTION,
      instanceArn: 'arn:aws:sso:::instance/ssoins-test',
      accountId: '123456789012',
      permissionSetArn: 'arn:aws:sso:::permissionSet/ssoins-test/ps-test',
      principalType: 'GROUP',
      principalId: 'group-1',
    },
    operation: mockOperations.executeIdentityCenterDeleteAccountAssignment,
  },
  {
    toolId: 'identity_center_check_assignment_status',
    input: {
      ...CONNECTION,
      instanceArn: 'arn:aws:sso:::instance/ssoins-test',
      requestId: 'request-1',
    },
    operation: mockOperations.executeIdentityCenterCheckAssignmentStatus,
  },
  {
    toolId: 'identity_center_check_assignment_deletion_status',
    input: {
      ...CONNECTION,
      instanceArn: 'arn:aws:sso:::instance/ssoins-test',
      requestId: 'request-1',
    },
    operation: mockOperations.executeIdentityCenterCheckAssignmentDeletionStatus,
  },
  {
    toolId: 'identity_center_list_account_assignments',
    input: {
      ...CONNECTION,
      instanceArn: 'arn:aws:sso:::instance/ssoins-test',
      principalType: 'USER',
      principalId: 'user-1',
    },
    operation: mockOperations.executeIdentityCenterListAccountAssignments,
  },
] as const

describe('executeIdentityCenterTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches $toolId', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeIdentityCenterTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeIdentityCenterTool(
      createRequest({ input: { region: 'invalid' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeIdentityCenterListInstances).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope', async () => {
    mockOperations.executeIdentityCenterListInstances.mockRejectedValue(
      new Error('AWS rejected credentials')
    )

    const response = await executeIdentityCenterTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to list Identity Center instances: AWS rejected credentials',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeIdentityCenterTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeIdentityCenterListInstances).not.toHaveBeenCalled()
  })
})
