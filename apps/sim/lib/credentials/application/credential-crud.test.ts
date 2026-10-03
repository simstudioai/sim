import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  blockVisibilityMock,
  blockVisibilityMockFns,
} from '@sim/testing/mocks/block-visibility.mock'
import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import { permissionsMock } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceCredential: vi.fn(),
  getCredentialById: vi.fn(),
  updateRecord: vi.fn(),
  createRecord: vi.fn(),
  personalAccounts: vi.fn(),
  createPersonalToken: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/credentials/queries', () => ({
  getWorkspaceCredential: hoisted.getWorkspaceCredential,
  getCredentialById: hoisted.getCredentialById,
}))
vi.mock('@/lib/credentials/access', () => credentialsAccessMock)
vi.mock('@/lib/credentials/orchestration', () => ({
  updateCredentialRecord: hoisted.updateRecord,
  createCredentialRecord: hoisted.createRecord,
  isProviderOutageCode: () => false,
}))
vi.mock('@/lib/credentials/application/workspace-personal-accounts', () => ({
  requireWorkspacePersonalAccounts: hoisted.personalAccounts,
}))
vi.mock('@/lib/credentials/personal-tokens', () => ({
  createPersonalTokenCredential: hoisted.createPersonalToken,
  updatePersonalTokenCredential: vi.fn(),
}))
vi.mock('@/lib/core/config/block-visibility', () => blockVisibilityMock)
vi.mock('@/lib/integrations/principal-scope.server', () => ({ allowedIntegrationTypes: vi.fn() }))
vi.mock('@/lib/integrations/credential-visibility.server', () => ({
  createIntegrationCredentialVisibility: () => ({ isCredentialVisible: () => true }),
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/credentials/oauth', () => ({ syncWorkspaceOAuthCredentialsForUser: vi.fn() }))
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { PermissionGroupCapabilityError } from '@/lib/core/application'
import {
  createWorkspaceCredential,
  updateWorkspaceCredentialUseCase,
} from '@/lib/credentials/application/credential-crud'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const mocks = {
  ...hoisted,
  getActor: credentialsAccessMockFns.mockGetCredentialActorContext,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

credentialsAccessMockFns.mockCanUseCredential.mockReturnValue(true)
credentialsAccessMockFns.mockRequireOrdinaryCredentialType.mockImplementation((type) => type)
blockVisibilityMockFns.mockGetBlockVisibility.mockResolvedValue(undefined)

const WORKSPACE_ID = 'workspace-1'
const OTHER_WORKSPACE_ID = 'workspace-2'
const workspace = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const apiKeyPrincipal = createPersonalApiKeyPrincipal()
const sessionPrincipal = createSessionPrincipal()
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

  it('refuses a workspace API key before any canonical load', async () => {
    await expect(
      updateWorkspaceCredentialUseCase.execute({
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID }),
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
})

describe('personal-credential capability', () => {
  const ORGANIZATION_ID = 'organization-1'
  const governedWorkspace = { ...workspace, workspaceOrganizationId: ORGANIZATION_ID }

  function createdCredential(type: 'env_personal' | 'env_workspace') {
    return { ...credential, type, envKey: 'OPENAI_API_KEY', encryptedServiceAccountKey: null }
  }

  beforeEach(() => {
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
  it('declares the capability on each connection operation that governs both of its targets', () => {
    for (const operationName of [
      'createConnection',
      'prepareConnection',
      'launchConnection',
    ] as const) {
      expect(credentialOperations[operationName].capability).toBe('integrations.manage')
    }
  })

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
    resolveGroupConfigMock.mockResolvedValue(null)
    mocks.loadWorkspace.mockResolvedValue({ ...workspace, workspaceOrganizationId: 'organization' })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.personalAccounts.mockResolvedValue(accounts)
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
