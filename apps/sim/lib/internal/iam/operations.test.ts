/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateIAMClient, mockDestroy, mockListUsers } = vi.hoisted(() => ({
  mockCreateIAMClient: vi.fn(),
  mockDestroy: vi.fn(),
  mockListUsers: vi.fn(),
}))

vi.mock('@/lib/internal/iam/client', () => ({
  addUserToGroup: vi.fn(),
  attachRolePolicy: vi.fn(),
  attachUserPolicy: vi.fn(),
  createAccessKey: vi.fn(),
  createIAMClient: mockCreateIAMClient,
  createRole: vi.fn(),
  createUser: vi.fn(),
  deleteAccessKey: vi.fn(),
  deleteRole: vi.fn(),
  deleteUser: vi.fn(),
  detachRolePolicy: vi.fn(),
  detachUserPolicy: vi.fn(),
  getRole: vi.fn(),
  getUser: vi.fn(),
  listAttachedRolePolicies: vi.fn(),
  listAttachedUserPolicies: vi.fn(),
  listGroups: vi.fn(),
  listPolicies: vi.fn(),
  listRoles: vi.fn(),
  listUsers: mockListUsers,
  removeUserFromGroup: vi.fn(),
  simulatePrincipalPolicy: vi.fn(),
}))

import { executeIamListUsers } from '@/lib/internal/iam/operations'

const INPUT = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  pathPrefix: '/engineering/',
  maxItems: 25,
  marker: 'next-page',
}

describe('IAM operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateIAMClient.mockReturnValue({ destroy: mockDestroy })
  })

  it('forwards cancellation and destroys the AWS client after success', async () => {
    const controller = new AbortController()
    const result = { users: [], isTruncated: false, marker: null, count: 0 }
    mockListUsers.mockResolvedValue(result)

    await expect(executeIamListUsers(INPUT, controller.signal)).resolves.toBe(result)
    expect(mockListUsers).toHaveBeenCalledWith(
      { destroy: mockDestroy },
      '/engineering/',
      25,
      'next-page',
      controller.signal
    )
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('destroys the AWS client when provider execution fails', async () => {
    mockListUsers.mockRejectedValue(new Error('provider failure'))

    await expect(executeIamListUsers(INPUT)).rejects.toThrow('provider failure')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
