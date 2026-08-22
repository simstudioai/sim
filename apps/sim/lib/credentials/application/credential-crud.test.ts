/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getWorkspaceCredential: vi.fn(),
  getCredentialById: vi.fn(),
  getActor: vi.fn(),
  updateRecord: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/queries', () => ({
  getWorkspaceCredential: mocks.getWorkspaceCredential,
  getCredentialById: mocks.getCredentialById,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getActor,
  canUseCredential: () => true,
}))
vi.mock('@/lib/credentials/orchestration', () => ({
  updateCredentialRecord: mocks.updateRecord,
  createCredentialRecord: vi.fn(),
  isProviderOutageCode: () => false,
}))
vi.mock('@/lib/credentials/oauth', () => ({ syncWorkspaceOAuthCredentialsForUser: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))

import {
  CredentialProviderOperationError,
  updateWorkspaceCredentialUseCase,
} from '@/lib/credentials/application/credential-crud'

const WORKSPACE_ID = 'workspace-1'
const OTHER_WORKSPACE_ID = 'workspace-2'
const workspace = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const apiKeyPrincipal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const sessionPrincipal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
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

describe('updateWorkspaceCredentialUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getWorkspaceCredential.mockResolvedValue(credential)
    mocks.getCredentialById.mockResolvedValue(credential)
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })
    mocks.updateRecord.mockResolvedValue({
      success: true,
      updatedFields: ['encryptedServiceAccountKey'],
      auditMetadata: { principal: 'zoom-account' },
    })
  })

  it('rotates a service-account secret for a personal API key', async () => {
    const result = await updateWorkspaceCredentialUseCase.execute({
      principal: apiKeyPrincipal,
      input: {
        credentialId: credential.id,
        assertedWorkspaceId: WORKSPACE_ID,
        clientSecret: 'rotated',
      },
    })

    expect(result.credential).toEqual(credential)
    expect(result.updatedFields).toEqual(['encryptedServiceAccountKey'])
  })

  /**
   * The asserted workspace is a scope comparison, not a field to write. Passing
   * it through to the manager would put a caller-supplied key into the update
   * builder's argument object.
   */
  it('scopes the canonical load without forwarding the assertion to the manager', async () => {
    await updateWorkspaceCredentialUseCase.execute({
      principal: apiKeyPrincipal,
      input: {
        credentialId: credential.id,
        assertedWorkspaceId: WORKSPACE_ID,
        displayName: 'Zoom prod',
      },
    })

    expect(mocks.getWorkspaceCredential).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      credentialId: credential.id,
    })
    expect(mocks.updateRecord).toHaveBeenCalledWith({
      credentialId: credential.id,
      displayName: 'Zoom prod',
      credential,
    })
    expect(mocks.updateRecord.mock.calls[0][0]).not.toHaveProperty('assertedWorkspaceId')
  })

  it('conceals a credential the asserted workspace does not own as a not-found', async () => {
    mocks.getWorkspaceCredential.mockResolvedValue(null)

    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: apiKeyPrincipal,
        input: {
          credentialId: credential.id,
          assertedWorkspaceId: OTHER_WORKSPACE_ID,
          displayName: 'Zoom prod',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.updateRecord).not.toHaveBeenCalled()
  })

  /** The internal surface omits the assertion and keeps its previous behavior. */
  it('resolves the credential by id when no workspace is asserted', async () => {
    await updateWorkspaceCredentialUseCase.execute({
      principal: sessionPrincipal,
      input: { credentialId: credential.id, displayName: 'Zoom prod' },
    })

    expect(mocks.getCredentialById).toHaveBeenCalledWith(credential.id)
    expect(mocks.getWorkspaceCredential).not.toHaveBeenCalled()
  })

  /**
   * Without this an API key could rename an environment secret through a surface
   * whose presenter throws on that type, turning a well-formed request into a
   * 500.
   */
  it('refuses an environment credential for an API key before mutating', async () => {
    const envCredential = { ...credential, type: 'env_workspace' as const }
    mocks.getWorkspaceCredential.mockResolvedValue(envCredential)
    mocks.getActor.mockResolvedValue({
      credential: envCredential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: apiKeyPrincipal,
        input: {
          credentialId: credential.id,
          assertedWorkspaceId: WORKSPACE_ID,
          displayName: 'Renamed',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.updateRecord).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('lets a session rename the same environment credential', async () => {
    const envCredential = { ...credential, type: 'env_workspace' as const }
    mocks.getCredentialById.mockResolvedValue(envCredential)
    mocks.getActor.mockResolvedValue({
      credential: envCredential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: sessionPrincipal,
        input: { credentialId: credential.id, description: 'Shared key' },
      })
    ).resolves.toMatchObject({ credential: envCredential })
  })

  it('refuses a workspace API key before any canonical load', async () => {
    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' },
        input: {
          credentialId: credential.id,
          assertedWorkspaceId: WORKSPACE_ID,
          displayName: 'Zoom prod',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.updateRecord).not.toHaveBeenCalled()
  })

  it('refuses a credential member who is not a credential admin', async () => {
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'member' },
      hasWorkspaceAccess: true,
      isAdmin: false,
    })

    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: apiKeyPrincipal,
        input: {
          credentialId: credential.id,
          assertedWorkspaceId: WORKSPACE_ID,
          displayName: 'Zoom prod',
        },
      })
    ).rejects.toMatchObject({ detailCode: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED' })
    expect(mocks.updateRecord).not.toHaveBeenCalled()
  })

  /**
   * A provider outage and a provider rejection are the same class here; the
   * surface, not the use case, decides their statuses. What matters is that the
   * distinguishing flag survives.
   */
  it('raises a provider failure carrying its outage flag, and records no audit', async () => {
    mocks.updateRecord.mockResolvedValue({
      success: false,
      error: 'upstream unreachable',
      providerErrorCode: 'provider_unavailable',
      providerUnavailable: true,
    })

    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: apiKeyPrincipal,
        input: {
          credentialId: credential.id,
          assertedWorkspaceId: WORKSPACE_ID,
          clientSecret: 'rotated',
        },
      })
    ).rejects.toMatchObject({
      name: 'CredentialProviderOperationError',
      providerErrorCode: 'provider_unavailable',
      providerUnavailable: true,
    })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('projects the authoritative updated fields into the audit entry', async () => {
    await updateWorkspaceCredentialUseCase.execute({
      principal: apiKeyPrincipal,
      input: {
        credentialId: credential.id,
        assertedWorkspaceId: WORKSPACE_ID,
        clientSecret: 'rotated',
      },
    })

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: credential.id,
        metadata: expect.objectContaining({
          updatedFields: ['encryptedServiceAccountKey'],
          credentialType: 'service_account',
        }),
      })
    )
  })

  it('exports the provider failure class the surface maps', () => {
    const error = new CredentialProviderOperationError('down', 'provider_unavailable', true)

    expect(error.providerUnavailable).toBe(true)
    expect(error.code).toBe('validation')
  })
})
