/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DeleteSecretInput,
  ListSecretUsageInput,
  SetSecretInput,
} from '@/lib/secrets/application/use-cases'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    loadContext: vi.fn(),
    resolvePermission: vi.fn(),
    workspaceAccess: vi.fn(),
    keyAccess: vi.fn(),
    personalMetadata: vi.fn(),
    setWorkspace: vi.fn(),
    setPersonal: vi.fn(),
    deletePersonal: vi.fn(),
    listCredentials: vi.fn(),
    readWorkspaceValues: vi.fn(),
    secretUsage: vi.fn(),
    workspaceEnvValue: vi.fn(),
    scanReferences: vi.fn(),
    audit: vi.fn(),
  },
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    ENVIRONMENT_UPDATED: 'environment.updated',
    ENVIRONMENT_DELETED: 'environment.deleted',
  },
  AuditResourceType: { ENVIRONMENT: 'environment' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.workspaceAccess,
}))
vi.mock('@/lib/credentials/environment', () => ({
  getWorkspaceEnvKeyAdminAccess: mocks.keyAccess,
  getPersonalEnvCredentialMetadata: mocks.personalMetadata,
  hasWorkspaceEnvValue: mocks.workspaceEnvValue,
}))
vi.mock('@/lib/secrets/references/scan', () => ({
  scanSecretReferences: mocks.scanReferences,
}))
vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: mocks.listCredentials,
}))
vi.mock('@/lib/secrets/usage/queries', () => ({
  getSecretUsage: mocks.secretUsage,
}))
vi.mock('@/lib/credentials/secret-values', () => ({
  deletePersonalSecret: mocks.deletePersonal,
  deleteWorkspaceSecret: vi.fn(),
  readWorkspaceSecretValues: mocks.readWorkspaceValues,
  setPersonalSecret: mocks.setPersonal,
  setWorkspaceSecret: mocks.setWorkspace,
}))

import {
  deleteSecretUseCase,
  type ListSecretReferencesInput,
  listSecretReferencesUseCase,
  listSecretsUseCase,
  listSecretUsageUseCase,
  setSecretUseCase,
} from '@/lib/secrets/application/use-cases'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const secret = {
  id: 'secret-1',
  workspaceId: workspace.workspaceId,
  type: 'env_workspace' as const,
  displayName: 'STRIPE_API_KEY',
  description: null,
  providerId: null,
  accountId: null,
  envKey: 'STRIPE_API_KEY',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: false,
  role: 'admin' as const,
  unredacted: false,
}

const visibleSecret = {
  ...secret,
  id: 'secret-3',
  displayName: 'STAGING_BASE_URL',
  envKey: 'STAGING_BASE_URL',
  unredacted: true,
}

const personalUpdatedAt = new Date('2026-02-01T00:00:00Z')
const personalSecret = {
  ...secret,
  id: 'secret-2',
  type: 'env_personal' as const,
  displayName: 'OPENAI_API_KEY',
  envKey: 'OPENAI_API_KEY',
  envOwnerUserId: 'user-1',
}

const session = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

describe('secret application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.setWorkspace.mockResolvedValue({ created: true, updatedAt: personalUpdatedAt })
    mocks.setPersonal.mockResolvedValue({ created: true, updatedAt: personalUpdatedAt })
    mocks.personalMetadata.mockResolvedValue(null)
    mocks.deletePersonal.mockResolvedValue(true)
    mocks.listCredentials.mockResolvedValue({ data: [secret], nextCursorKeys: null })
    mocks.readWorkspaceValues.mockResolvedValue({})
    mocks.secretUsage.mockResolvedValue({ entries: [] })
  })

  it('reads values for exactly the visible (unredacted) workspace rows on the page', async () => {
    mocks.listCredentials.mockResolvedValue({
      data: [secret, visibleSecret, personalSecret],
      nextCursorKeys: null,
    })
    mocks.readWorkspaceValues.mockResolvedValue({
      [visibleSecret.envKey]: 'https://staging.example.com',
    })

    const result = await listSecretsUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 50,
      },
    })

    expect(mocks.readWorkspaceValues).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      names: [visibleSecret.envKey],
    })
    expect(result.values).toEqual({ [visibleSecret.envKey]: 'https://staging.example.com' })
  })

  it('never asks for values when no row on the page is marked visible', async () => {
    mocks.listCredentials.mockResolvedValue({
      data: [secret, personalSecret],
      nextCursorKeys: null,
    })

    const result = await listSecretsUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 50,
      },
    })

    expect(mocks.readWorkspaceValues).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      names: [],
    })
    expect(result.values).toEqual({})
  })

  it('rejects workspace keys before resolving or reading secret state', async () => {
    const execute = setSecretUseCase.execute as (args: {
      principal: Principal
      input: SetSecretInput
    }) => Promise<unknown>

    await expect(
      execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: workspace.workspaceId,
          keyId: 'workspace-key-1',
        },
        input: {
          workspaceId: workspace.workspaceId,
          name: secret.envKey,
          scope: 'workspace',
          value: 'secret-value',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
    expect(mocks.setWorkspace).not.toHaveBeenCalled()
  })

  it('checks ACLs, writes through the manager, and audits without the secret value', async () => {
    const result = await setSecretUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: workspace.workspaceId,
        name: secret.envKey,
        scope: 'workspace',
        value: 'secret-value',
      },
    })

    expect(result.created).toBe(true)
    expect(mocks.keyAccess).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      envKeys: [secret.envKey],
      userId: 'user-1',
    })
    expect(mocks.setWorkspace).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      name: secret.envKey,
      value: 'secret-value',
      userId: 'user-1',
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        metadata: expect.objectContaining({ operation: 'secrets.set', scope: 'workspace' }),
      })
    )
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('secret-value')
  })

  it('forwards a workspace description to the manager', async () => {
    await setSecretUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: workspace.workspaceId,
        name: secret.envKey,
        scope: 'workspace',
        value: 'secret-value',
        description: 'Prod billing key',
      },
    })

    expect(mocks.setWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Prod billing key' })
    )
  })

  it('refuses a description on a personal secret in the use case, not just the contract', async () => {
    await expect(
      setSecretUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: workspace.workspaceId,
          name: secret.envKey,
          scope: 'personal',
          value: 'secret-value',
          description: 'has no shared audience',
        },
      })
    ).rejects.toThrow(/only supported for a workspace secret/)
  })

  it('refuses unredacted on a personal secret in the use case, not just the contract', async () => {
    await expect(
      setSecretUseCase.execute({
        principal: session,
        input: {
          workspaceId: workspace.workspaceId,
          name: secret.envKey,
          scope: 'personal',
          value: 'secret-value',
          unredacted: true,
        },
      })
    ).rejects.toThrow(/unredacted is only supported for a workspace secret/)

    expect(mocks.setPersonal).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('forwards the workspace unredacted flag to the manager and audits its value', async () => {
    await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: secret.envKey,
        scope: 'workspace',
        value: 'secret-value',
        unredacted: true,
      },
    })

    expect(mocks.setWorkspace).toHaveBeenCalledWith(expect.objectContaining({ unredacted: true }))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ unredacted: true }) })
    )
  })

  it('audits the recorded value when the flag is explicitly turned off', async () => {
    await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: secret.envKey,
        scope: 'workspace',
        value: 'secret-value',
        unredacted: false,
      },
    })

    expect(mocks.setWorkspace).toHaveBeenCalledWith(expect.objectContaining({ unredacted: false }))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ unredacted: false }) })
    )
  })

  it('omits unredacted from the audit metadata when it was not provided', async () => {
    await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: secret.envKey,
        scope: 'workspace',
        value: 'secret-value',
      },
    })

    const metadata = (mocks.audit.mock.calls[0][0] as { metadata: Record<string, unknown> })
      .metadata
    expect(metadata).not.toHaveProperty('unredacted')
  })

  it('still fails a workspace write whose metadata never materialized', async () => {
    mocks.listCredentials.mockResolvedValue({ data: [], nextCursorKeys: null })

    await expect(
      setSecretUseCase.execute({
        principal: session,
        input: {
          workspaceId: workspace.workspaceId,
          name: secret.envKey,
          scope: 'workspace',
          value: 'secret-value',
        },
      })
    ).rejects.toThrow(/workspace:STRIPE_API_KEY/)
  })

  it('reports a committed personal write when this workspace holds no mirror', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: true })
    mocks.listCredentials.mockResolvedValue({ data: [], nextCursorKeys: null })

    const result = await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: personalSecret.envKey,
        scope: 'personal',
        value: 'secret-value',
      },
    })

    expect(mocks.setPersonal).toHaveBeenCalledWith({
      userId: 'user-1',
      name: personalSecret.envKey,
      value: 'secret-value',
    })
    expect(result.created).toBe(true)
    expect(result.secret).toMatchObject({
      type: 'env_personal',
      envKey: personalSecret.envKey,
      envOwnerUserId: 'user-1',
      role: 'admin',
      createdAt: personalUpdatedAt,
      updatedAt: personalUpdatedAt,
    })
  })

  it('dates a mirrorless personal write from the secret the caller already owns', async () => {
    const createdAt = new Date('2025-06-01T00:00:00Z')
    mocks.listCredentials.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.personalMetadata.mockResolvedValue({
      id: 'secret-2',
      createdAt,
      updatedAt: createdAt,
    })
    mocks.setPersonal.mockResolvedValue({ created: false, updatedAt: personalUpdatedAt })

    const result = await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: personalSecret.envKey,
        scope: 'personal',
        value: 'secret-value',
      },
    })

    expect(mocks.personalMetadata).toHaveBeenCalledWith({
      userId: 'user-1',
      envKey: personalSecret.envKey,
    })
    expect(result.created).toBe(false)
    expect(result.secret).toMatchObject({
      id: 'secret-2',
      createdAt,
      updatedAt: personalUpdatedAt,
    })
  })

  it('prefers this workspace mirror for a personal write when one exists', async () => {
    mocks.listCredentials.mockResolvedValue({ data: [personalSecret], nextCursorKeys: null })

    const result = await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: personalSecret.envKey,
        scope: 'personal',
        value: 'secret-value',
      },
    })

    expect(result.secret).toBe(personalSecret)
    expect(mocks.personalMetadata).not.toHaveBeenCalled()
  })

  it('deletes a personal secret for the caller rather than for one workspace', async () => {
    const execute = deleteSecretUseCase.execute as (args: {
      principal: Principal
      input: DeleteSecretInput
    }) => Promise<{ name: string; scope: string }>

    const result = await execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: personalSecret.envKey,
        scope: 'personal',
      },
    })

    expect(mocks.deletePersonal).toHaveBeenCalledWith({
      userId: 'user-1',
      name: personalSecret.envKey,
    })
    expect(result).toEqual({ name: personalSecret.envKey, scope: 'personal' })
  })
})

describe('listSecretUsageUseCase', () => {
  const execute = listSecretUsageUseCase.execute as (args: {
    principal: Principal
    input: ListSecretUsageInput
  }) => Promise<unknown>

  const workspaceInput: ListSecretUsageInput = {
    workspaceId: workspace.workspaceId,
    name: 'STRIPE_API_KEY',
    scope: 'workspace',
    limit: 100,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.secretUsage.mockResolvedValue({ entries: [] })
  })

  /**
   * The trail names workflows, people, and run ids. A Member who may use the secret but not
   * read it must not get that back — it is a slice of exactly what value masking withholds.
   */
  it('denies a credential member who is not an admin of the key', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({
      knownKeys: new Set(['STRIPE_API_KEY']),
      adminKeys: new Set(),
    })

    await expect(execute({ principal: session, input: workspaceInput })).rejects.toThrow(
      'Credential admin permission required to view this secret usage'
    )
    expect(mocks.secretUsage).not.toHaveBeenCalled()
  })

  it('allows a credential admin of that key', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({
      knownKeys: new Set(['STRIPE_API_KEY']),
      adminKeys: new Set(['STRIPE_API_KEY']),
    })

    await expect(execute({ principal: session, input: workspaceInput })).resolves.toMatchObject({
      entries: [],
    })
    expect(mocks.secretUsage).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      secretName: 'STRIPE_API_KEY',
      secretScope: 'workspace',
      secretOwnerUserId: '',
      limit: 100,
    })
  })

  it('allows a workspace admin without a per-key grant', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: true })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })

    await expect(execute({ principal: session, input: workspaceInput })).resolves.toBeDefined()
  })

  /** A personal secret is only ever the caller's own namespace, so there is nothing to gate. */
  it('reads a personal secret without a credential-admin check', async () => {
    await expect(
      execute({ principal: session, input: { ...workspaceInput, scope: 'personal' } })
    ).resolves.toBeDefined()
    expect(mocks.workspaceAccess).not.toHaveBeenCalled()
    expect(mocks.keyAccess).not.toHaveBeenCalled()
  })
})

describe('listSecretReferencesUseCase', () => {
  const execute = listSecretReferencesUseCase.execute as (args: {
    principal: Principal
    input: ListSecretReferencesInput
  }) => Promise<unknown>

  const input: ListSecretReferencesInput = {
    workspaceId: workspace.workspaceId,
    name: 'STRIPE_API_KEY',
  }
  const scan = { workflows: [], resources: [], truncated: false }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.scanReferences.mockResolvedValue(scan)
  })

  /**
   * The map names workflows, blocks, tools and servers. A Member who may use the secret but not
   * read it has no claim on it, so this must fail the same way the usage trail does.
   */
  it('denies a member who is not an admin of a workspace key', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.workspaceEnvValue.mockResolvedValue(true)

    await expect(execute({ principal: session, input })).rejects.toThrow(
      'Credential admin permission required to view this secret usage'
    )
    expect(mocks.scanReferences).not.toHaveBeenCalled()
  })

  /**
   * The gate reads the authoritative variables map, not `knownKeys`. A legacy value predating
   * the credential ACL has no `env_workspace` row yet still wins at run time, so treating an
   * empty `knownKeys` as "no workspace secret" would hand a non-admin exactly the oldest keys.
   */
  it('denies a personal owner when a legacy workspace value shares the name', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.workspaceEnvValue.mockResolvedValue(true)
    mocks.personalMetadata.mockResolvedValue({ id: 'cred-1' })

    await expect(execute({ principal: session, input })).rejects.toThrow(
      'Credential admin permission required to view this secret usage'
    )
    expect(mocks.scanReferences).not.toHaveBeenCalled()
  })

  it('denies a caller who holds no secret of that name', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.workspaceEnvValue.mockResolvedValue(false)
    mocks.personalMetadata.mockResolvedValue(null)

    await expect(execute({ principal: session, input })).rejects.toThrow(
      'Credential admin permission required to view this secret usage'
    )
    expect(mocks.scanReferences).not.toHaveBeenCalled()
  })

  it('allows the owner of a personal secret that no workspace value shadows', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.workspaceEnvValue.mockResolvedValue(false)
    mocks.personalMetadata.mockResolvedValue({ id: 'cred-1' })

    await expect(execute({ principal: session, input })).resolves.toEqual(scan)
  })

  it('allows a credential admin of that key', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({
      knownKeys: new Set(['STRIPE_API_KEY']),
      adminKeys: new Set(['STRIPE_API_KEY']),
    })

    await expect(execute({ principal: session, input })).resolves.toEqual(scan)
    // An admin stays authorized however the name resolves, so the volatile input is never read.
    expect(mocks.workspaceEnvValue).not.toHaveBeenCalled()
  })

  /**
   * A `personal` grant rests on no workspace value existing under the name. If one is created
   * between the check and the scan, the map now in hand is admin-gated — so the condition is
   * re-read after the scan and the request fails closed rather than returning it.
   */
  it('refuses when a workspace value appears between the check and the scan', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.personalMetadata.mockResolvedValue({ id: 'cred-1' })
    mocks.workspaceEnvValue.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(execute({ principal: session, input })).rejects.toThrow(
      'Credential admin permission required to view this secret usage'
    )
    expect(mocks.workspaceEnvValue).toHaveBeenCalledTimes(2)
  })
})
