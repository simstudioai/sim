/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEncryptSecret,
  mockCreateWorkspaceEnvCredentials,
  mockDeleteWorkspaceEnvCredentials,
  mockUpsertPersonalEnvCredentialForUser,
  mockDeletePersonalEnvCredentialForUser,
  mockInvalidateEffectiveDecryptedEnvCache,
} = vi.hoisted(() => ({
  mockEncryptSecret: vi.fn(),
  mockCreateWorkspaceEnvCredentials: vi.fn(),
  mockDeleteWorkspaceEnvCredentials: vi.fn(),
  mockUpsertPersonalEnvCredentialForUser: vi.fn(),
  mockDeletePersonalEnvCredentialForUser: vi.fn(),
  mockInvalidateEffectiveDecryptedEnvCache: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: mockEncryptSecret }))
vi.mock('@/lib/credentials/environment', () => ({
  createWorkspaceEnvCredentials: mockCreateWorkspaceEnvCredentials,
  deleteWorkspaceEnvCredentials: mockDeleteWorkspaceEnvCredentials,
  upsertPersonalEnvCredentialForUser: mockUpsertPersonalEnvCredentialForUser,
  deletePersonalEnvCredentialForUser: mockDeletePersonalEnvCredentialForUser,
}))
vi.mock('@/lib/environment/utils', () => ({
  invalidateEffectiveDecryptedEnvCache: mockInvalidateEffectiveDecryptedEnvCache,
}))

import {
  deletePersonalSecret,
  deleteWorkspaceSecret,
  setPersonalSecret,
  setWorkspaceSecret,
} from '@/lib/credentials/secret-values'

describe('secret value storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-new-value' })
  })

  it('merges a workspace value without decrypting or replacing sibling secrets', async () => {
    queueTableRows(schemaMock.workspaceEnvironment, [
      {
        id: 'env-1',
        variables: { EXISTING_KEY: 'encrypted-existing-value' },
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ])

    const result = await setWorkspaceSecret({
      workspaceId: 'workspace-1',
      name: 'NEW_KEY',
      value: 'plaintext-new-value',
      userId: 'user-1',
    })

    expect(result.created).toBe(true)
    expect(mockEncryptSecret).toHaveBeenCalledWith('plaintext-new-value')
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          EXISTING_KEY: 'encrypted-existing-value',
          NEW_KEY: 'encrypted-new-value',
        },
      })
    )
    expect(mockCreateWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        newKeys: ['NEW_KEY'],
        actingUserId: 'user-1',
        updatedAt: expect.any(Date),
        executor: expect.any(Object),
      })
    )
    expect(mockInvalidateEffectiveDecryptedEnvCache).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    })
  })

  it('reports an existing workspace value as an update', async () => {
    queueTableRows(schemaMock.workspaceEnvironment, [
      {
        id: 'env-1',
        variables: { EXISTING_KEY: 'encrypted-existing-value' },
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ])

    const result = await setWorkspaceSecret({
      workspaceId: 'workspace-1',
      name: 'EXISTING_KEY',
      value: 'replacement',
      userId: 'user-1',
    })

    expect(result.created).toBe(false)
  })

  it('sets a personal value through caller-owned metadata only', async () => {
    queueTableRows(schemaMock.environment, [])

    const result = await setPersonalSecret({
      userId: 'user-1',
      name: 'PERSONAL_KEY',
      value: 'personal-value',
    })

    expect(result.created).toBe(true)
    expect(mockUpsertPersonalEnvCredentialForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        envKey: 'PERSONAL_KEY',
        executor: expect.any(Object),
      })
    )
    expect(mockInvalidateEffectiveDecryptedEnvCache).toHaveBeenCalledWith({ userId: 'user-1' })
  })

  it('deletes only the requested workspace value', async () => {
    queueTableRows(schemaMock.workspaceEnvironment, [
      { variables: { DELETE_ME: 'cipher-1', KEEP_ME: 'cipher-2' } },
    ])

    const deleted = await deleteWorkspaceSecret({
      workspaceId: 'workspace-1',
      name: 'DELETE_ME',
    })

    expect(deleted).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { KEEP_ME: 'cipher-2' } })
    )
    expect(mockDeleteWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        removedKeys: ['DELETE_ME'],
        executor: expect.any(Object),
      })
    )
  })

  it('does not mutate metadata when a personal value does not exist', async () => {
    queueTableRows(schemaMock.environment, [{ variables: { KEEP_ME: 'cipher' } }])

    const deleted = await deletePersonalSecret({ userId: 'user-1', name: 'MISSING' })

    expect(deleted).toBe(false)
    expect(mockDeletePersonalEnvCredentialForUser).not.toHaveBeenCalled()
    expect(mockInvalidateEffectiveDecryptedEnvCache).not.toHaveBeenCalled()
  })
})
