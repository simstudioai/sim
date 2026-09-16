/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getWorkspaceCredential: vi.fn(),
  getCredentialById: vi.fn(),
  getActor: vi.fn(),
  updateRecord: vi.fn(),
  createRecord: vi.fn(),
  personalAccounts: vi.fn(),
  createPersonalToken: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

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
  requireOrdinaryCredentialType: (type: string) => type,
}))
vi.mock('@/lib/credentials/orchestration', () => ({
  updateCredentialRecord: mocks.updateRecord,
  createCredentialRecord: mocks.createRecord,
  isProviderOutageCode: () => false,
}))
vi.mock('@/lib/credentials/application/workspace-personal-accounts', () => ({
  requireWorkspacePersonalAccounts: mocks.personalAccounts,
}))
vi.mock('@/lib/credentials/personal-tokens', () => ({
  createPersonalTokenCredential: mocks.createPersonalToken,
  updatePersonalTokenCredential: vi.fn(),
}))
vi.mock('@/lib/core/config/block-visibility', () => ({ getBlockVisibility: vi.fn() }))
vi.mock('@/lib/integrations/principal-scope.server', () => ({ allowedIntegrationTypes: vi.fn() }))
vi.mock('@/lib/integrations/credential-visibility.server', () => ({
  createIntegrationCredentialVisibility: () => ({ isCredentialVisible: () => true }),
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/credentials/oauth', () => ({ syncWorkspaceOAuthCredentialsForUser: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))

import { PermissionGroupCapabilityError } from '@/lib/core/application'
import {
  CredentialProviderOperationError,
  createWorkspaceCredential,
  updateWorkspaceCredentialUseCase,
} from '@/lib/credentials/application/credential-crud'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

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

describe('personal-credential capability', () => {
  const ORGANIZATION_ID = 'organization-1'
  const governedWorkspace = { ...workspace, workspaceOrganizationId: ORGANIZATION_ID }

  function createdCredential(type: 'env_personal' | 'env_workspace') {
    return { ...credential, type, envKey: 'OPENAI_API_KEY', encryptedServiceAccountKey: null }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(governedWorkspace)
    mocks.resolvePermission.mockResolvedValue('admin')
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalCredentials: true,
    })
  })

  /**
   * A connection operation takes a target, not a scope: the same operation
   * connects an account and re-authorizes a workspace-shared credential.
   * `credentials.personal` belongs to the first branch only and is asserted
   * there; the operation carries the capability that governs both. Pinned
   * because declaring the narrower one here compiles just as well, and it
   * refused the shared credentials that setting exists to mandate.
   */
  it.each(['createConnection', 'prepareConnection', 'launchConnection'] as const)(
    'declares the capability on %s that governs both of its targets',
    (operationName) => {
      expect(credentialOperations[operationName].capability).toBe('integrations.manage')
    }
  )

  it('refuses a personal environment secret before it reaches the manager', async () => {
    await expect(
      createWorkspaceCredential.execute({
        principal: sessionPrincipal,
        input: {
          workspaceId: WORKSPACE_ID,
          type: 'env_personal',
          displayName: 'My OpenAI key',
          envKey: 'OPENAI_API_KEY',
        },
      })
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)

    expect(mocks.createRecord).not.toHaveBeenCalled()
  })

  /**
   * Scope is the request's `type`, so the same operation must still serve the
   * workspace-shared secret the organization is steering members toward.
   */
  it('still creates a workspace-shared secret under the same restriction', async () => {
    const created = createdCredential('env_workspace')
    mocks.createRecord.mockResolvedValue({ success: true, created: true, credential: created })
    mocks.getActor.mockResolvedValue({
      credential: created,
      member: { role: 'admin', status: 'active' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    const result = await createWorkspaceCredential.execute({
      principal: sessionPrincipal,
      input: {
        workspaceId: WORKSPACE_ID,
        type: 'env_workspace',
        displayName: 'Shared OpenAI key',
        envKey: 'OPENAI_API_KEY',
      },
    })

    expect(result.credential).toEqual(created)
  })

  it('creates the personal secret when no group withholds it', async () => {
    resolveGroupConfigMock.mockResolvedValue(null)
    const created = createdCredential('env_personal')
    mocks.createRecord.mockResolvedValue({ success: true, created: true, credential: created })
    mocks.getActor.mockResolvedValue({
      credential: created,
      member: { role: 'admin', status: 'active' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    const result = await createWorkspaceCredential.execute({
      principal: sessionPrincipal,
      input: {
        workspaceId: WORKSPACE_ID,
        type: 'env_personal',
        displayName: 'My OpenAI key',
        envKey: 'OPENAI_API_KEY',
      },
    })

    expect(result.credential).toEqual(created)
  })
})

describe('personal-token organization enrollment', () => {
  const accounts = { organizationId: 'organization', credentialGroupId: 'organization-group' }
  const tokenInput = {
    workspaceId: WORKSPACE_ID,
    type: 'personal_token' as const,
    providerId: 'gitlab',
    displayName: 'My GitLab',
    apiToken: 'personal-token',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveGroupConfigMock.mockResolvedValue(null)
    mocks.loadWorkspace.mockResolvedValue({ ...workspace, workspaceOrganizationId: 'organization' })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.personalAccounts.mockResolvedValue(accounts)
  })

  it('passes the authorized organization group into token creation', async () => {
    const created = { ...credential, type: 'personal_token', providerId: 'gitlab' }
    mocks.createPersonalToken.mockResolvedValue({
      success: true,
      created: true,
      credential: created,
    })
    mocks.getActor.mockResolvedValue({ credential: created, isAdmin: true })
    await createWorkspaceCredential.execute({ principal: sessionPrincipal, input: tokenInput })
    expect(mocks.personalAccounts).toHaveBeenCalledWith(
      sessionPrincipal,
      expect.objectContaining({ workspaceOrganizationId: 'organization' })
    )
    expect(mocks.createPersonalToken).toHaveBeenCalledWith({
      ...tokenInput,
      userId: 'user-1',
      accounts,
    })
    expect(mocks.createRecord).not.toHaveBeenCalled()
  })

  it('refuses unapproved organization access before verifying or storing a token', async () => {
    mocks.personalAccounts.mockRejectedValueOnce(new Error('Organization accounts unavailable'))
    await expect(
      createWorkspaceCredential.execute({ principal: sessionPrincipal, input: tokenInput })
    ).rejects.toThrow('Organization accounts unavailable')
    expect(mocks.createPersonalToken).not.toHaveBeenCalled()
    expect(mocks.createRecord).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
})
