import type { Principal } from '@sim/auth/principal'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DeleteSecretInput,
  ListSecretUsageInput,
  SetSecretInput,
} from '@/lib/secrets/application/use-cases'

const { mocks: hoisted } = vi.hoisted(() => ({
  mocks: {
    setWorkspace: vi.fn(),
    updateWorkspaceMetadata: vi.fn(),
    setPersonal: vi.fn(),
    deletePersonal: vi.fn(),
    listCredentials: vi.fn(),
    readWorkspaceValues: vi.fn(),
    secretUsage: vi.fn(),
    scanReferences: vi.fn(),
  },
}))

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)
vi.mock('@/lib/secrets/references/scan', () => ({
  scanSecretReferences: hoisted.scanReferences,
}))
vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: hoisted.listCredentials,
}))
vi.mock('@/lib/secrets/usage/queries', () => ({
  getSecretUsage: hoisted.secretUsage,
}))
vi.mock('@/lib/credentials/secret-values', () => ({
  deletePersonalSecret: hoisted.deletePersonal,
  deleteWorkspaceSecret: vi.fn(),
  readWorkspaceSecretValues: hoisted.readWorkspaceValues,
  setPersonalSecret: hoisted.setPersonal,
  setWorkspaceSecret: hoisted.setWorkspace,
  updateWorkspaceSecretMetadata: hoisted.updateWorkspaceMetadata,
}))

import {
  deleteSecretUseCase,
  type ListSecretReferencesInput,
  listSecretReferencesUseCase,
  listSecretsUseCase,
  listSecretUsageUseCase,
  setSecretUseCase,
} from '@/lib/secrets/application/use-cases'

const mocks = {
  ...hoisted,
  keyAccess: credentialsEnvironmentMockFns.mockGetWorkspaceEnvKeyAdminAccess,
  personalMetadata: credentialsEnvironmentMockFns.mockGetPersonalEnvCredentialMetadata,
  workspaceEnvValue: credentialsEnvironmentMockFns.mockHasWorkspaceEnvValue,
  loadContext: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  workspaceAccess: permissionsMockFns.mockCheckWorkspaceAccess,
  audit: auditMockFns.mockRecordAudit,
}

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

const session = createSessionPrincipal()

describe('secret application use cases', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.setWorkspace.mockResolvedValue({ created: true, updatedAt: personalUpdatedAt })
    mocks.updateWorkspaceMetadata.mockResolvedValue({
      created: false,
      updatedAt: personalUpdatedAt,
    })
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

  it('rejects workspace keys before resolving or reading secret state', async () => {
    const execute = setSecretUseCase.execute as (args: {
      principal: Principal
      input: SetSecretInput
    }) => Promise<unknown>

    await expect(
      execute({
        principal: createWorkspaceApiKeyPrincipal({
          workspaceId: workspace.workspaceId,
          keyId: 'workspace-key-1',
        }),
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
      principal: createSessionPrincipal(),
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

  it('refuses a description on a personal secret in the use case, not just the contract', async () => {
    await expect(
      setSecretUseCase.execute({
        principal: createSessionPrincipal(),
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

  it('updates workspace metadata through the update-only manager, never re-encrypting the value', async () => {
    const result = await setSecretUseCase.execute({
      principal: session,
      input: {
        workspaceId: workspace.workspaceId,
        name: secret.envKey,
        scope: 'workspace',
        unredacted: false,
      },
    })

    expect(mocks.updateWorkspaceMetadata).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      name: secret.envKey,
      description: undefined,
      unredacted: false,
    })
    expect(mocks.setWorkspace).not.toHaveBeenCalled()
    expect(mocks.setPersonal).not.toHaveBeenCalled()
    expect(result.created).toBe(false)
  })

  it('still checks the per-key ACL before a metadata-only write', async () => {
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({
      knownKeys: new Set([secret.envKey]),
      adminKeys: new Set(),
    })

    await expect(
      setSecretUseCase.execute({
        principal: session,
        input: {
          workspaceId: workspace.workspaceId,
          name: secret.envKey,
          scope: 'workspace',
          unredacted: true,
        },
      })
    ).rejects.toThrow(/Credential admin permission required/)

    expect(mocks.updateWorkspaceMetadata).not.toHaveBeenCalled()
  })

  it('reports a metadata write against a missing secret as not found rather than creating one', async () => {
    mocks.updateWorkspaceMetadata.mockResolvedValue(null)

    await expect(
      setSecretUseCase.execute({
        principal: session,
        input: {
          workspaceId: workspace.workspaceId,
          name: secret.envKey,
          scope: 'workspace',
          unredacted: true,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.setWorkspace).not.toHaveBeenCalled()
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
