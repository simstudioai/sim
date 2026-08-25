/**
 * @vitest-environment node
 */
import { environment, workspaceEnvironment } from '@sim/db/schema'
import {
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateWorkspaceEnvCredentials,
  mockCheckWorkspaceAccess,
  mockGetAccessibleEnvCredentials,
  mockGetUserEntityPermissions,
  mockGetWorkspaceEnvKeyAdminAccess,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockCreateWorkspaceEnvCredentials: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetAccessibleEnvCredentials: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

// vitest.setup.ts mocks this module globally; this suite tests the real one.
vi.unmock('@/lib/environment/utils')

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@sim/audit', () => ({
  AuditAction: { ENVIRONMENT_UPDATED: 'environment.updated' },
  AuditResourceType: { ENVIRONMENT: 'environment' },
  recordAudit: mockRecordAudit,
}))
vi.mock('@/lib/credentials/environment', () => ({
  createWorkspaceEnvCredentials: mockCreateWorkspaceEnvCredentials,
  getAccessibleEnvCredentials: mockGetAccessibleEnvCredentials,
  getWorkspaceEnvKeyAdminAccess: mockGetWorkspaceEnvKeyAdminAccess,
  syncPersonalEnvCredentialsForUser: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import {
  getEffectiveDecryptedEnv,
  getEffectiveEnvironmentSnapshot,
  getExecutionEnvironment,
  getPersonalAndWorkspaceEnv,
  invalidateEffectiveDecryptedEnvCache,
  upsertWorkspaceEnvVars,
  WorkspaceEnvAccessError,
} from '@/lib/environment/utils'

describe('getPersonalAndWorkspaceEnv access filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: false,
    })
    mockGetAccessibleEnvCredentials.mockResolvedValue([])
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `plain:${encryptedValue}`,
    }))
  })

  it('filters every workspace secret when the caller has zero credential grants', async () => {
    queueTableRows(environment, [{ variables: { PERSONAL_KEY: 'personal-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])

    const snapshot = await getPersonalAndWorkspaceEnv('user-1', 'workspace-1')

    expect(snapshot.personalDecrypted).toEqual({ PERSONAL_KEY: 'plain:personal-cipher' })
    expect(snapshot.workspaceDecrypted).toEqual({})
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('preserves legacy workspace secrets without credential rows for workspace admins', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
    })
    queueTableRows(environment, [{ variables: {} }])
    queueTableRows(workspaceEnvironment, [{ variables: { LEGACY_KEY: 'legacy-cipher' } }])

    const snapshot = await getPersonalAndWorkspaceEnv('admin-1', 'workspace-1')

    expect(snapshot.workspaceDecrypted).toEqual({ LEGACY_KEY: 'plain:legacy-cipher' })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('collects workspaceUnredactedKeys only from flagged env_workspace credential rows', async () => {
    mockGetAccessibleEnvCredentials.mockResolvedValue([
      {
        type: 'env_workspace',
        envKey: 'VISIBLE_KEY',
        envOwnerUserId: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        unredacted: true,
      },
      {
        type: 'env_workspace',
        envKey: 'HIDDEN_KEY',
        envOwnerUserId: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        unredacted: false,
      },
      {
        type: 'env_personal',
        envKey: 'PERSONAL_KEY',
        envOwnerUserId: 'user-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        unredacted: true,
      },
    ])
    queueTableRows(environment, [{ variables: {} }])
    queueTableRows(workspaceEnvironment, [
      { variables: { VISIBLE_KEY: 'visible-cipher', HIDDEN_KEY: 'hidden-cipher' } },
    ])

    const snapshot = await getPersonalAndWorkspaceEnv('user-1', 'workspace-1')

    expect(snapshot.workspaceUnredactedKeys).toEqual(['VISIBLE_KEY'])
  })

  it('preserves shared-personal precedence when an accessible owner shares the same name', async () => {
    mockGetAccessibleEnvCredentials.mockResolvedValue([
      {
        type: 'env_personal',
        envKey: 'SHARED_KEY',
        envOwnerUserId: 'owner-2',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    queueTableRows(environment, [{ variables: { SHARED_KEY: 'own-cipher' } }])
    queueTableRows(environment, [{ userId: 'owner-2', variables: { SHARED_KEY: 'shared-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: {} }])

    const snapshot = await getPersonalAndWorkspaceEnv('user-1', 'workspace-1')

    expect(snapshot.personalDecrypted).toEqual({ SHARED_KEY: 'plain:shared-cipher' })
    expect(snapshot.personalOwners).toEqual({ SHARED_KEY: 'owner-2' })
  })
})

describe('getExecutionEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetAccessibleEnvCredentials.mockResolvedValue([])
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `plain:${encryptedValue}`,
    }))
  })

  /** Grants workspace-admin access to one identity so the two slices diverge observably. */
  function grantAdminTo(adminUserId: string) {
    mockCheckWorkspaceAccess.mockImplementation(async (_workspaceId: string, userId: string) => ({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: userId === adminUserId,
    }))
  }

  it('resolves each slice against its own identity', async () => {
    grantAdminTo('actor-1')
    /**
     * Queued rows are FIFO per table, and the actor resolves first: its access was
     * already decided, so it skips the `checkWorkspaceAccess` await the personal
     * resolution still performs. Only the actor is a workspace admin, so the owner's
     * own workspace slice resolves empty and could not be the one that lands.
     */
    queueTableRows(environment, [{ variables: { ACTOR_ONLY: 'actor-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])
    queueTableRows(environment, [{ variables: { PERSONAL_KEY: 'personal-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])

    const snapshot = await getExecutionEnvironment('owner-1', 'actor-1', 'workspace-1')

    expect(snapshot.personalDecrypted).toEqual({ PERSONAL_KEY: 'plain:personal-cipher' })
    expect(snapshot.workspaceDecrypted).toEqual({ WORKSPACE_KEY: 'plain:workspace-cipher' })
  })

  it('resolves once when both identities are the same', async () => {
    grantAdminTo('owner-1')
    queueTableRows(environment, [{ variables: { PERSONAL_KEY: 'personal-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])

    const snapshot = await getExecutionEnvironment('owner-1', 'owner-1', 'workspace-1')

    expect(mockCheckWorkspaceAccess).toHaveBeenCalledOnce()
    expect(snapshot.personalDecrypted).toEqual({ PERSONAL_KEY: 'plain:personal-cipher' })
    expect(snapshot.workspaceDecrypted).toEqual({ WORKSPACE_KEY: 'plain:workspace-cipher' })
  })

  it('drops the personal slice entirely when no personal identity is supplied', async () => {
    grantAdminTo('billing-account')
    queueTableRows(environment, [{ variables: { PERSONAL_KEY: 'personal-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])

    const snapshot = await getExecutionEnvironment(undefined, 'billing-account', 'workspace-1')

    expect(snapshot.personalDecrypted).toEqual({})
    expect(snapshot.personalEncrypted).toEqual({})
    expect(snapshot.workspaceDecrypted).toEqual({ WORKSPACE_KEY: 'plain:workspace-cipher' })
  })

  it('carries the ACTOR workspaceUnredactedKeys on a split-identity run', async () => {
    grantAdminTo('actor-1')
    mockGetAccessibleEnvCredentials.mockImplementation(
      async (_workspaceId: string, userId: string) => [
        {
          type: 'env_workspace',
          envKey: userId === 'actor-1' ? 'ACTOR_VISIBLE' : 'OWNER_VISIBLE',
          envOwnerUserId: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          unredacted: true,
        },
      ]
    )
    queueTableRows(environment, [{ variables: {} }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])
    queueTableRows(environment, [{ variables: {} }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])

    const snapshot = await getExecutionEnvironment('owner-1', 'actor-1', 'workspace-1')

    expect(snapshot.workspaceUnredactedKeys).toEqual(['ACTOR_VISIBLE'])
  })

  it('keeps workspaceUnredactedKeys on an anonymous workspace-only run', async () => {
    grantAdminTo('billing-account')
    mockGetAccessibleEnvCredentials.mockResolvedValue([
      {
        type: 'env_workspace',
        envKey: 'WORKSPACE_VISIBLE',
        envOwnerUserId: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        unredacted: true,
      },
    ])
    queueTableRows(environment, [{ variables: {} }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_VISIBLE: 'workspace-cipher' } }])

    const snapshot = await getExecutionEnvironment(undefined, 'billing-account', 'workspace-1')

    expect(snapshot.personalDecrypted).toEqual({})
    expect(snapshot.workspaceUnredactedKeys).toEqual(['WORKSPACE_VISIBLE'])
  })

  it('falls back to the personal identity when the actor cannot reach the workspace', async () => {
    mockCheckWorkspaceAccess.mockImplementation(async (_workspaceId: string, userId: string) => ({
      exists: true,
      hasAccess: userId === 'owner-1',
      canWrite: true,
      canAdmin: true,
    }))
    queueTableRows(environment, [{ variables: { PERSONAL_KEY: 'personal-cipher' } }])
    queueTableRows(workspaceEnvironment, [{ variables: { WORKSPACE_KEY: 'workspace-cipher' } }])

    const snapshot = await getExecutionEnvironment('owner-1', 'departed-payer', 'workspace-1')

    expect(snapshot.personalDecrypted).toEqual({ PERSONAL_KEY: 'plain:personal-cipher' })
    expect(snapshot.workspaceDecrypted).toEqual({ WORKSPACE_KEY: 'plain:workspace-cipher' })
  })
})

describe('upsertWorkspaceEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'cipher' })
  })

  it('refuses to overwrite an existing secret the caller does not administer', async () => {
    // Workspace `write` is what the copilot tool checks; the route additionally
    // requires secret-admin on the specific key. Without this the agent was the
    // weaker path to the same write.
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['STRIPE_KEY']),
    })

    const error = await upsertWorkspaceEnvVars('ws-1', { STRIPE_KEY: 'rotated' }, 'user-1').catch(
      (e) => e
    )

    expect(error).toBeInstanceOf(WorkspaceEnvAccessError)
    expect(error).toMatchObject({
      reason: 'not-secret-admin',
      message: 'You must be an admin of these secrets to edit them',
    })
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses to add a new secret without workspace write', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })

    const error = await upsertWorkspaceEnvVars('ws-1', { NEW_KEY: 'value' }, 'user-1').catch(
      (e) => e
    )

    expect(error).toBeInstanceOf(WorkspaceEnvAccessError)
    // Distinct from the secret-admin denial: the route answers this case with a
    // write-access message, and the agent surfaces whatever we throw verbatim.
    expect(error).toMatchObject({
      reason: 'write-access-required',
      message: 'Write access is required to add new secrets',
    })
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  function stubStoredVariables(variables: Record<string, string>) {
    dbChainMockFns.limit.mockResolvedValue([{ variables }])
  }

  it('allows a key admin to rotate the key they administer', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set(['STRIPE_KEY']),
      knownKeys: new Set(['STRIPE_KEY']),
    })
    stubStoredVariables({ STRIPE_KEY: 'old-cipher' })

    await expect(
      upsertWorkspaceEnvVars('ws-1', { STRIPE_KEY: 'rotated' }, 'user-1')
    ).resolves.toEqual(['STRIPE_KEY'])

    expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith('rotated')
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', actorId: 'user-1' })
    )
  })

  it('treats a workspace admin as an admin of every key', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['STRIPE_KEY']),
    })
    stubStoredVariables({ STRIPE_KEY: 'old-cipher' })

    await expect(
      upsertWorkspaceEnvVars('ws-1', { STRIPE_KEY: 'rotated' }, 'user-1')
    ).resolves.toEqual(['STRIPE_KEY'])
  })

  it('records no audit and takes no lock for an empty update', async () => {
    await expect(upsertWorkspaceEnvVars('ws-1', {}, 'user-1')).resolves.toEqual([])

    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('does not mint a credential for a legacy secret already in the stored map', async () => {
    // A secret written before credential rows existed has no ACL. Treating it as
    // new would create one and make the caller its secret-admin — the route
    // derives newKeys from the stored variables for exactly this reason.
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })
    stubStoredVariables({ LEGACY_KEY: 'old-cipher' })

    await upsertWorkspaceEnvVars('ws-1', { LEGACY_KEY: 'rotated' }, 'user-1')

    expect(mockCreateWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ newKeys: [] })
    )
  })

  it('mints a credential for a genuinely new key', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })
    stubStoredVariables({})

    await upsertWorkspaceEnvVars('ws-1', { BRAND_NEW: 'value' }, 'user-1')

    expect(mockCreateWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ newKeys: ['BRAND_NEW'] })
    )
  })
})

describe('effective environment resolution cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    encryptionMockFns.mockDecryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockReset()
    invalidateEffectiveDecryptedEnvCache({ userId: 'user-1' })
    dbChainMockFns.limit.mockResolvedValue([{ variables: { API_KEY: 'encrypted-value' } }])
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'runtime-value' })
  })

  it('shares one atomic snapshot and returns defensive clones', async () => {
    const [decrypted, snapshot] = await Promise.all([
      getEffectiveDecryptedEnv('user-1'),
      getEffectiveEnvironmentSnapshot('user-1'),
    ])

    expect(decrypted).toEqual({ API_KEY: 'runtime-value' })
    expect(snapshot).toMatchObject({
      personalEncrypted: { API_KEY: 'encrypted-value' },
      personalDecrypted: { API_KEY: 'runtime-value' },
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()

    decrypted.API_KEY = 'mutated-runtime'
    snapshot.personalEncrypted.API_KEY = 'mutated-ciphertext'
    snapshot.personalDecrypted.API_KEY = 'mutated-snapshot'
    snapshot.conflicts.push('MUTATED')

    await expect(getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'runtime-value',
    })
    await expect(getEffectiveEnvironmentSnapshot('user-1')).resolves.toMatchObject({
      personalEncrypted: { API_KEY: 'encrypted-value' },
      personalDecrypted: { API_KEY: 'runtime-value' },
      conflicts: [],
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('evicts rejected loads and retries the canonical lookup', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(getEffectiveEnvironmentSnapshot('user-1')).rejects.toThrow('database unavailable')

    dbChainMockFns.limit.mockResolvedValue([{ variables: { API_KEY: 'encrypted-value' } }])
    await expect(getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'runtime-value',
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('reloads the full snapshot after invalidation', async () => {
    await expect(getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'runtime-value',
    })

    invalidateEffectiveDecryptedEnvCache({ userId: 'user-1' })
    dbChainMockFns.limit.mockResolvedValue([{ variables: { API_KEY: 'rotated-ciphertext' } }])
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'rotated-runtime' })

    await expect(getEffectiveEnvironmentSnapshot('user-1')).resolves.toMatchObject({
      personalEncrypted: { API_KEY: 'rotated-ciphertext' },
      personalDecrypted: { API_KEY: 'rotated-runtime' },
    })
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledTimes(2)
  })
})
