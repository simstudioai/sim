/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateWorkspaceEnvCredentials,
  mockEncryptSecret,
  mockGetUserEntityPermissions,
  mockGetWorkspaceEnvKeyAdminAccess,
  mockRecordAudit,
  mockTx,
} = vi.hoisted(() => ({
  mockCreateWorkspaceEnvCredentials: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockTx: {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
  },
}))

// vitest.setup.ts mocks this module globally; this suite tests the real one.
vi.unmock('@/lib/environment/utils')

vi.mock('@sim/audit', () => ({
  AuditAction: { ENVIRONMENT_UPDATED: 'environment.updated' },
  AuditResourceType: { ENVIRONMENT: 'environment' },
  recordAudit: mockRecordAudit,
}))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(),
  encryptSecret: mockEncryptSecret,
}))
vi.mock('@/lib/credentials/environment', () => ({
  createWorkspaceEnvCredentials: mockCreateWorkspaceEnvCredentials,
  getAccessibleEnvCredentials: vi.fn(),
  getWorkspaceEnvKeyAdminAccess: mockGetWorkspaceEnvKeyAdminAccess,
  syncPersonalEnvCredentialsForUser: vi.fn(),
}))
vi.mock('@sim/db', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)),
  },
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { upsertWorkspaceEnvVars, WorkspaceEnvAccessError } from '@/lib/environment/utils'

describe('upsertWorkspaceEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEncryptSecret.mockResolvedValue({ encrypted: 'cipher' })
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

    await expect(
      upsertWorkspaceEnvVars('ws-1', { STRIPE_KEY: 'rotated' }, 'user-1')
    ).rejects.toBeInstanceOf(WorkspaceEnvAccessError)

    expect(mockEncryptSecret).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses to add a new secret without workspace write', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })

    await expect(
      upsertWorkspaceEnvVars('ws-1', { NEW_KEY: 'value' }, 'user-1')
    ).rejects.toBeInstanceOf(WorkspaceEnvAccessError)

    expect(mockEncryptSecret).not.toHaveBeenCalled()
  })

  function stubStoredVariables(variables: Record<string, string>) {
    mockTx.execute.mockResolvedValue(undefined)
    mockTx.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ variables }] }) }),
    })
    mockTx.insert.mockReturnValue({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    })
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

    expect(mockEncryptSecret).toHaveBeenCalledWith('rotated')
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
