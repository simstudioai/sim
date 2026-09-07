/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateSSOAdminClient, mockDestroy, mockListInstances } = vi.hoisted(() => ({
  mockCreateSSOAdminClient: vi.fn(),
  mockDestroy: vi.fn(),
  mockListInstances: vi.fn(),
}))

vi.mock('@/lib/internal/identity-center/client', () => ({
  checkAssignmentCreationStatus: vi.fn(),
  checkAssignmentDeletionStatus: vi.fn(),
  createAccountAssignment: vi.fn(),
  createIdentityStoreClient: vi.fn(),
  createOrganizationsClient: vi.fn(),
  createSSOAdminClient: mockCreateSSOAdminClient,
  deleteAccountAssignment: vi.fn(),
  describeAccount: vi.fn(),
  describeGroupById: vi.fn(),
  describeUserById: vi.fn(),
  getGroupByDisplayName: vi.fn(),
  getUserByEmail: vi.fn(),
  listAccountAssignmentsForAccount: vi.fn(),
  listAccountAssignmentsForPrincipal: vi.fn(),
  listAccounts: vi.fn(),
  listGroupMemberships: vi.fn(),
  listGroups: vi.fn(),
  listInstances: mockListInstances,
  listPermissionSets: vi.fn(),
}))

import { executeIdentityCenterListInstances } from '@/lib/internal/identity-center/operations'

const INPUT = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  maxResults: 10,
  nextToken: 'next-token',
}

describe('Identity Center operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSSOAdminClient.mockReturnValue({ destroy: mockDestroy })
  })

  it('forwards cancellation and destroys the AWS client after success', async () => {
    const controller = new AbortController()
    const result = { instances: [], nextToken: null, count: 0 }
    mockListInstances.mockResolvedValue(result)

    await expect(executeIdentityCenterListInstances(INPUT, controller.signal)).resolves.toBe(result)
    expect(mockListInstances).toHaveBeenCalledWith(
      { destroy: mockDestroy },
      10,
      'next-token',
      controller.signal
    )
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('destroys the AWS client when provider execution fails', async () => {
    mockListInstances.mockRejectedValue(new Error('provider failure'))

    await expect(executeIdentityCenterListInstances(INPUT)).rejects.toThrow('provider failure')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
