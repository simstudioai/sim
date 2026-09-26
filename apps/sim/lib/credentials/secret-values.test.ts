import {
  dbChainMockFns,
  flattenMockConditions,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { environmentUtilsMockFns } from '@sim/testing/mocks/environment-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
const mockEncryptSecret = encryptionMockFns.mockEncryptSecret
const mockDecryptSecret = encryptionMockFns.mockDecryptSecret
vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)

import {
  deletePersonalSecret,
  deleteWorkspaceSecret,
  readWorkspaceSecretValues,
  setWorkspaceSecret,
  updateWorkspaceSecretMetadata,
} from '@/lib/credentials/secret-values'

const mockInvalidateEffectiveDecryptedEnvCache =
  environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache
const mockDeletePersonalEnvCredentialForUser =
  credentialsEnvironmentMockFns.mockDeletePersonalEnvCredentialForUser

describe('secret value storage', () => {
  beforeEach(() => {
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
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          EXISTING_KEY: 'encrypted-existing-value',
          NEW_KEY: 'encrypted-new-value',
        },
      })
    )
    expect(mockInvalidateEffectiveDecryptedEnvCache).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    })
  })

  it('leaves the stored unredacted flag alone when the caller omits it', async () => {
    queueTableRows(schemaMock.workspaceEnvironment, [
      {
        id: 'env-1',
        variables: { STRIPE_KEY: 'encrypted-existing-value' },
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ])

    await setWorkspaceSecret({
      workspaceId: 'workspace-1',
      name: 'STRIPE_KEY',
      value: 'rotated',
      userId: 'user-1',
    })

    const credentialUpdate = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
    expect(credentialUpdate).not.toHaveProperty('unredacted')
    expect(credentialUpdate).not.toHaveProperty('description')
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
  })

  it('does not mutate metadata when a personal value does not exist', async () => {
    queueTableRows(schemaMock.environment, [{ variables: { KEEP_ME: 'cipher' } }])

    const deleted = await deletePersonalSecret({ userId: 'user-1', name: 'MISSING' })

    expect(deleted).toBe(false)
    expect(mockDeletePersonalEnvCredentialForUser).not.toHaveBeenCalled()
    expect(mockInvalidateEffectiveDecryptedEnvCache).not.toHaveBeenCalled()
  })
})

describe('readWorkspaceSecretValues', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: `decrypted:${encrypted}`,
    }))
  })

  it('decrypts only the requested names and omits absent or undecryptable ones', async () => {
    queueTableRows(schemaMock.workspaceEnvironment, [
      {
        id: 'env-1',
        variables: {
          VISIBLE_KEY: 'encrypted-visible',
          BROKEN_KEY: 'encrypted-broken',
          OTHER_KEY: 'encrypted-other',
        },
      },
    ])
    mockDecryptSecret.mockImplementation(async (encrypted: string) => {
      if (encrypted === 'encrypted-broken') throw new Error('cannot decrypt')
      return { decrypted: `decrypted:${encrypted}` }
    })

    await expect(
      readWorkspaceSecretValues({
        workspaceId: 'workspace-1',
        names: ['VISIBLE_KEY', 'BROKEN_KEY', 'MISSING_KEY'],
      })
    ).resolves.toEqual({ VISIBLE_KEY: 'decrypted:encrypted-visible' })
    expect(mockDecryptSecret).not.toHaveBeenCalledWith('encrypted-other')
  })

  it('never reads an inherited prototype member for a missing key', async () => {
    queueTableRows(schemaMock.workspaceEnvironment, [
      { id: 'env-1', variables: { OTHER_KEY: 'encrypted-other' } },
    ])

    await expect(
      readWorkspaceSecretValues({ workspaceId: 'workspace-1', names: ['constructor', 'toString'] })
    ).resolves.toEqual({})
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })
})

/**
 * The row-queue mocks resolve whatever was queued regardless of the predicate, so
 * the only way to pin a WHERE clause is to read the condition tree the `eq`/`and`
 * mocks recorded. An unscoped metadata UPDATE would let any workspace flip another
 * workspace's secret out of redaction by name, and the cache invalidation would
 * then push that flag into the other workspace's runtime redaction catalog — so the
 * count is asserted alongside the triple: a dropped condition is exactly the shape
 * a "contains" check alone would let through.
 */
function updateConditions(): MockCondition[] {
  const call = dbChainMockFns.where.mock.calls.at(-1)
  return flattenMockConditions(call?.[0])
}

describe('workspace secret metadata updates', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('scopes the update to this workspace, the env_workspace type, and the named key alone', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'credential-1' }])

    await updateWorkspaceSecretMetadata({
      workspaceId: 'workspace-1',
      name: 'STRIPE_KEY',
      unredacted: false,
    })

    const conditions = updateConditions()
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.credential.workspaceId,
      right: 'workspace-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.credential.type,
      right: 'env_workspace',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: schemaMock.credential.envKey,
      right: 'STRIPE_KEY',
    })
    expect(conditions).toHaveLength(3)
    expect(mockInvalidateEffectiveDecryptedEnvCache).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    })
  })

  it('reports a miss instead of creating a secret, and leaves the cache alone', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      updateWorkspaceSecretMetadata({
        workspaceId: 'workspace-1',
        name: 'ABSENT_KEY',
        unredacted: true,
      })
    ).resolves.toBeNull()

    expect(mockInvalidateEffectiveDecryptedEnvCache).not.toHaveBeenCalled()
  })
})
