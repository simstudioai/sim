/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetSecretInput } from '@/lib/secrets/application/use-cases'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    loadContext: vi.fn(),
    resolvePermission: vi.fn(),
    workspaceAccess: vi.fn(),
    keyAccess: vi.fn(),
    setWorkspace: vi.fn(),
    listCredentials: vi.fn(),
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
}))
vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: mocks.listCredentials,
}))
vi.mock('@/lib/credentials/secret-values', () => ({
  deletePersonalSecret: vi.fn(),
  deleteWorkspaceSecret: vi.fn(),
  setPersonalSecret: vi.fn(),
  setWorkspaceSecret: mocks.setWorkspace,
}))

import { setSecretUseCase } from '@/lib/secrets/application/use-cases'

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
}

describe('secret application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })
    mocks.keyAccess.mockResolvedValue({ knownKeys: new Set(), adminKeys: new Set() })
    mocks.setWorkspace.mockResolvedValue({ created: true })
    mocks.listCredentials.mockResolvedValue([secret])
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
})
