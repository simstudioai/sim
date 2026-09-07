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
  executeIdentityCenterListAssignmentsForAccount: vi.fn(),
  executeIdentityCenterDescribeUser: vi.fn(),
  executeIdentityCenterDescribeGroup: vi.fn(),
  executeIdentityCenterListGroupMemberships: vi.fn(),
}))

vi.mock('@/lib/internal/identity-center/operations', () => mockOperations)

import { executeIdentityCenterTool } from '@/lib/internal/identity-center/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

const INSTANCE_ARN = 'arn:aws:sso:::instance/ssoins-1234567890abcdef'
const PERMISSION_SET_ARN = 'arn:aws:sso:::permissionSet/ssoins-1234567890abcdef/ps-1234567890abcdef'
const IDENTITY_STORE_ID = 'd-1234567890'
const USER_PRINCIPAL_ID = '9067b2d8-8021-70f8-1234-5c6d7e8f9012'
const GROUP_PRINCIPAL_ID = '1234567890-a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'
const REQUEST_ID = '11111111-2222-3333-4444-555555555555'

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
    input: { ...CONNECTION, instanceArn: INSTANCE_ARN },
    operation: mockOperations.executeIdentityCenterListPermissionSets,
  },
  {
    toolId: 'identity_center_get_user',
    input: { ...CONNECTION, identityStoreId: IDENTITY_STORE_ID, email: 'user@example.com' },
    operation: mockOperations.executeIdentityCenterGetUser,
  },
  {
    toolId: 'identity_center_get_group',
    input: { ...CONNECTION, identityStoreId: IDENTITY_STORE_ID, displayName: 'Engineering' },
    operation: mockOperations.executeIdentityCenterGetGroup,
  },
  {
    toolId: 'identity_center_list_groups',
    input: { ...CONNECTION, identityStoreId: IDENTITY_STORE_ID },
    operation: mockOperations.executeIdentityCenterListGroups,
  },
  {
    toolId: 'identity_center_create_account_assignment',
    input: {
      ...CONNECTION,
      instanceArn: INSTANCE_ARN,
      accountId: '123456789012',
      permissionSetArn: PERMISSION_SET_ARN,
      principalType: 'USER',
      principalId: USER_PRINCIPAL_ID,
    },
    operation: mockOperations.executeIdentityCenterCreateAccountAssignment,
  },
  {
    toolId: 'identity_center_delete_account_assignment',
    input: {
      ...CONNECTION,
      instanceArn: INSTANCE_ARN,
      accountId: '123456789012',
      permissionSetArn: PERMISSION_SET_ARN,
      principalType: 'GROUP',
      principalId: GROUP_PRINCIPAL_ID,
    },
    operation: mockOperations.executeIdentityCenterDeleteAccountAssignment,
  },
  {
    toolId: 'identity_center_check_assignment_status',
    input: {
      ...CONNECTION,
      instanceArn: INSTANCE_ARN,
      requestId: REQUEST_ID,
    },
    operation: mockOperations.executeIdentityCenterCheckAssignmentStatus,
  },
  {
    toolId: 'identity_center_check_assignment_deletion_status',
    input: {
      ...CONNECTION,
      instanceArn: INSTANCE_ARN,
      requestId: REQUEST_ID,
    },
    operation: mockOperations.executeIdentityCenterCheckAssignmentDeletionStatus,
  },
  {
    toolId: 'identity_center_list_account_assignments',
    input: {
      ...CONNECTION,
      instanceArn: INSTANCE_ARN,
      principalType: 'USER',
      principalId: USER_PRINCIPAL_ID,
    },
    operation: mockOperations.executeIdentityCenterListAccountAssignments,
  },
  {
    toolId: 'identity_center_list_assignments_for_account',
    input: {
      ...CONNECTION,
      instanceArn: INSTANCE_ARN,
      accountId: '123456789012',
      permissionSetArn: PERMISSION_SET_ARN,
    },
    operation: mockOperations.executeIdentityCenterListAssignmentsForAccount,
  },
  {
    toolId: 'identity_center_describe_user',
    input: {
      ...CONNECTION,
      identityStoreId: IDENTITY_STORE_ID,
      userId: USER_PRINCIPAL_ID,
    },
    operation: mockOperations.executeIdentityCenterDescribeUser,
  },
  {
    toolId: 'identity_center_describe_group',
    input: {
      ...CONNECTION,
      identityStoreId: IDENTITY_STORE_ID,
      groupId: GROUP_PRINCIPAL_ID,
    },
    operation: mockOperations.executeIdentityCenterDescribeGroup,
  },
  {
    toolId: 'identity_center_list_group_memberships',
    input: {
      ...CONNECTION,
      identityStoreId: IDENTITY_STORE_ID,
      groupId: GROUP_PRINCIPAL_ID,
    },
    operation: mockOperations.executeIdentityCenterListGroupMemberships,
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

  it.each([
    ['a malformed instance ARN', { ...CONNECTION, instanceArn: 'ssoins-test' }],
    ['a truncated request ID', { ...CONNECTION, instanceArn: INSTANCE_ARN, requestId: 'req-1' }],
  ])('rejects %s before provider work', async (_label, input) => {
    const response = await executeIdentityCenterTool(
      createRequest({ toolId: 'identity_center_check_assignment_status', input })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeIdentityCenterCheckAssignmentStatus).not.toHaveBeenCalled()
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
