/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  create: vi.fn(),
  listCatalog: vi.fn(),
  requireProvider: vi.fn(),
  getCredential: vi.fn(),
  getActor: vi.fn(),
  delete: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/orchestration', () => ({
  createServiceAccountCredential: mocks.create,
  deleteConnectionCredential: mocks.delete,
}))
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.listCatalog,
  requireAvailableServiceAccountCredentialProvider: mocks.requireProvider,
}))
vi.mock('@/lib/credentials/queries', () => ({
  getWorkspaceCredential: mocks.getCredential,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getActor,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import {
  createServiceAccountCredentialUseCase,
  deleteCredentialUseCase,
} from '@/lib/credentials/application/service-account'

const WORKSPACE_ID = 'workspace-1'
const workspace = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}
const credential = {
  id: 'credential-1',
  workspaceId: WORKSPACE_ID,
  type: 'service_account' as const,
  displayName: 'Zoom account',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  envKey: null,
  envOwnerUserId: null,
  encryptedServiceAccountKey: 'encrypted',
  createdBy: 'user-1',
  createdAt: new Date('2026-08-12T20:00:00.000Z'),
  updatedAt: new Date('2026-08-12T20:00:00.000Z'),
}

describe('credential service-account application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getCredential.mockResolvedValue(credential)
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })
    mocks.create.mockResolvedValue({
      success: true,
      credential,
      created: true,
      auditMetadata: { tenantId: 'tenant-1' },
    })
    mocks.listCatalog.mockResolvedValue([{ providerId: 'zoom-service-account' }])
    mocks.delete.mockResolvedValue(true)
    mocks.requireProvider.mockReturnValue({
      type: 'service_account',
      providerId: 'zoom-service-account',
      available: true,
    })
  })

  it('rejects workspace keys before canonical loading on create', async () => {
    await expect(
      createServiceAccountCredentialUseCase.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: WORKSPACE_ID,
          keyId: 'key-1',
        },
        input: {
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          orgId: 'account-id',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates through the verified service-account primitive', async () => {
    const result = await createServiceAccountCredentialUseCase.execute({
      principal,
      input: {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        orgId: 'account-id',
      },
    })

    expect(result).toMatchObject({
      credential,
      created: true,
      hasServiceAccountKey: true,
      role: 'admin',
    })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        providerId: 'zoom-service-account',
      })
    )
  })

  it('rejects service-account providers hidden by workspace policy', async () => {
    mocks.requireProvider.mockImplementation(() => {
      throw new OrchestrationError(
        'conflict',
        'Service-account provider is unavailable: zoom-service-account'
      )
    })

    await expect(
      createServiceAccountCredentialUseCase.execute({
        principal,
        input: {
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          orgId: 'account-id',
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('requires credential admin access before disconnecting', async () => {
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'member' },
      hasWorkspaceAccess: true,
      isAdmin: false,
    })

    await expect(
      deleteCredentialUseCase.execute({
        principal,
        input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before canonical loading on disconnect', async () => {
    await expect(
      deleteCredentialUseCase.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: WORKSPACE_ID,
          keyId: 'key-1',
        },
        input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED',
    })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.getActor).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('allows an explicit credential admin with workspace read access to disconnect', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      deleteCredentialUseCase.execute({
        principal,
        input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
      })
    ).resolves.toEqual({ credential, deleted: true })
    expect(mocks.delete).toHaveBeenCalledOnce()
  })

  it('applies credential admin policy during authorization-only checks', async () => {
    await deleteCredentialUseCase.authorize?.({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(mocks.getActor).toHaveBeenCalledWith(credential.id, principal.userId)
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('enforces personal-key workspace policy before credential authorization', async () => {
    mocks.loadWorkspace.mockResolvedValue({ ...workspace, allowPersonalApiKeys: false })

    await expect(
      deleteCredentialUseCase.execute({
        principal,
        input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'PERSONAL_API_KEYS_DISABLED',
    })
    expect(mocks.getActor).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('disconnects an administered credential', async () => {
    const result = await deleteCredentialUseCase.execute({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(result).toEqual({ credential, deleted: true })
    expect(mocks.delete).toHaveBeenCalledWith({
      credentialId: credential.id,
      workspaceId: WORKSPACE_ID,
      reason: 'user_delete',
    })
  })

  it('treats a concurrent disconnect as an idempotent success', async () => {
    mocks.delete.mockResolvedValue(false)

    const result = await deleteCredentialUseCase.execute({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(result).toEqual({ credential, deleted: false })
  })
})
