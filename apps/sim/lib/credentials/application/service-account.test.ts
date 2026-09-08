/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns } from '@sim/testing'
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
  deleteRecord: vi.fn(),
  capture: vi.fn(),
  environment: vi.fn(),
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
vi.mock('@/lib/credentials/orchestration', () => ({
  createServiceAccountCredential: mocks.create,
  deleteCredentialRecord: mocks.deleteRecord,
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
  requireOrdinaryCredentialType: (type: string) => {
    if (type === 'managed_oauth' || type === 'managed_mcp') {
      throw new Error('Managed credential reached an ordinary credential surface')
    }
    return type
  },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/environment/utils', () => ({ getEffectiveDecryptedEnv: mocks.environment }))

import {
  createServiceAccountCredentialUseCase,
  deleteCredentialUseCase,
} from '@/lib/credentials/application/service-account'
import { executeCopilotCredentialUseCase } from '@/lib/mothership/application/execute-credential-use-case'

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
    mocks.deleteRecord.mockResolvedValue(true)
    mocks.requireProvider.mockReturnValue({
      type: 'service_account',
      providerId: 'zoom-service-account',
      available: true,
    })
    mocks.environment.mockResolvedValue({ SIGNING: 'secret-signing', BOT: 'secret-bot' })
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

  const storedInput = {
    workspaceId: WORKSPACE_ID,
    displayName: 'Support bot',
    storedSlackSecrets: { signingSecretEnvVar: 'SIGNING', botTokenEnvVar: 'BOT' },
  }
  const copilotContext = {
    userId: 'user-1',
    workspaceId: WORKSPACE_ID,
    toolCallId: 'tool-1',
    copilotToolExecution: true,
  }
  const connectStored = (context = copilotContext, input = storedInput) =>
    executeCopilotCredentialUseCase(context, createServiceAccountCredentialUseCase, input)

  it('resolves stored Slack secrets as the delegated user and audits only credential metadata', async () => {
    await connectStored()
    expect(mocks.environment).toHaveBeenCalledWith('user-1', WORKSPACE_ID)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        providerId: 'slack-custom-bot',
        signingSecret: 'secret-signing',
        botToken: 'secret-bot',
        displayName: 'Support bot',
      })
    )
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('storedSlackSecrets')
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        metadata: expect.objectContaining({
          operation: 'credentials.service_accounts.create',
          actor: expect.objectContaining({
            kind: 'delegated',
            serviceId: 'copilot',
            subjectUserId: 'user-1',
          }),
        }),
      })
    )
    expect(JSON.stringify(auditMockFns.mockRecordAudit.mock.calls)).not.toContain('secret-signing')
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain('secret-bot')
  })

  it('rejects forged execution context before canonical loading', async () => {
    await expect(async () =>
      connectStored({ ...copilotContext, copilotToolExecution: false })
    ).rejects.toThrow('trusted')
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.environment).not.toHaveBeenCalled()
  })

  it('rejects cross-workspace delegation before resolving stored secrets', async () => {
    mocks.loadWorkspace.mockResolvedValueOnce({ ...workspace, workspaceId: 'other' })
    await expect(
      connectStored(copilotContext, { ...storedInput, workspaceId: 'other' })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.environment).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('checks current write permission before resolving stored secrets', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(connectStored()).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.environment).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('checks provider visibility before resolving stored secrets', async () => {
    mocks.requireProvider.mockImplementationOnce(() => {
      throw new OrchestrationError('conflict', 'Provider hidden')
    })
    await expect(connectStored()).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.environment).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('reports missing names without sending any partial credential to the provider', async () => {
    mocks.environment.mockResolvedValue({ SIGNING: 'secret-signing' })
    await expect(connectStored()).rejects.toThrow('Stored secrets unavailable: BOT')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('does not let delegated callers supply inline credential values', async () => {
    await expect(
      executeCopilotCredentialUseCase(copilotContext, createServiceAccountCredentialUseCase, {
        workspaceId: WORKSPACE_ID,
        providerId: 'slack-custom-bot',
        signingSecret: 'raw-signing',
        botToken: 'raw-token',
      })
    ).rejects.toThrow('must reference existing Sim secrets')
    expect(mocks.environment).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('does not duplicate creation audit or analytics when the primitive reuses a credential', async () => {
    mocks.create.mockResolvedValue({ success: true, credential, created: false })
    expect((await connectStored()).created).toBe(false)
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
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
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
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
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
  })

  it('allows an explicit credential admin with workspace read access to disconnect', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      deleteCredentialUseCase.execute({
        principal,
        input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
      })
    ).resolves.toEqual({ credential, deleted: true })
    expect(mocks.deleteRecord).toHaveBeenCalledOnce()
  })

  it('applies credential admin policy during authorization-only checks', async () => {
    await deleteCredentialUseCase.authorize?.({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(mocks.getActor).toHaveBeenCalledWith(credential.id, principal.userId)
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
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
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
  })

  it('disconnects an administered credential', async () => {
    const result = await deleteCredentialUseCase.execute({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(result).toEqual({ credential, deleted: true })
    expect(mocks.deleteRecord).toHaveBeenCalledWith({ credential, reason: 'user_delete' })
  })

  it('deletes every type through the record manager so secret sources are torn down', async () => {
    const oauthCredential = {
      ...credential,
      type: 'oauth',
      providerId: 'google-email',
      accountId: 'acct-1',
    }
    mocks.getCredential.mockResolvedValue(oauthCredential)
    mocks.getActor.mockResolvedValue({
      credential: oauthCredential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    const result = await deleteCredentialUseCase.execute({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: oauthCredential.id },
    })

    expect(result).toEqual({ credential: oauthCredential, deleted: true })
    expect(mocks.deleteRecord).toHaveBeenCalledWith({
      credential: oauthCredential,
      reason: 'user_delete',
    })
  })

  it('treats a concurrent disconnect as an idempotent success', async () => {
    mocks.deleteRecord.mockResolvedValue(false)

    const result = await deleteCredentialUseCase.execute({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(result).toEqual({ credential, deleted: false })
  })

  it.each([
    ['env_personal', 'personal'],
    ['env_workspace', 'workspace'],
  ] as const)('preserves %s deletion audit and analytics dimensions', async (type, label) => {
    const envCredential = {
      ...credential,
      type,
      displayName: 'MY_API_KEY',
      providerId: null,
      envKey: 'MY_API_KEY',
      envOwnerUserId: type === 'env_personal' ? 'user-1' : null,
      encryptedServiceAccountKey: null,
    }
    mocks.getCredential.mockResolvedValue(envCredential)
    mocks.getActor.mockResolvedValue({
      credential: envCredential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    await deleteCredentialUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: WORKSPACE_ID, credentialId: envCredential.id },
    })

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        description: `Deleted ${label} env credential "MY_API_KEY"`,
        metadata: expect.objectContaining({
          credentialType: type,
          envKey: 'MY_API_KEY',
        }),
      })
    )
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'credential_deleted',
      expect.objectContaining({ provider_id: 'MY_API_KEY' }),
      expect.anything()
    )
  })
})
