import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import { environmentUtilsMockFns } from '@sim/testing/mocks/environment-utils.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  listCatalog: vi.fn(),
  requireProvider: vi.fn(),
  getCredential: vi.fn(),
  deleteRecord: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/credentials/orchestration', () => ({
  createServiceAccountCredential: hoisted.create,
  deleteCredentialRecord: hoisted.deleteRecord,
}))
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: hoisted.listCatalog,
  requireAvailableServiceAccountCredentialProvider: hoisted.requireProvider,
}))
vi.mock('@/lib/credentials/queries', () => ({
  getWorkspaceCredential: hoisted.getCredential,
}))
vi.mock('@/lib/credentials/access', () => credentialsAccessMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import {
  createServiceAccountCredentialUseCase,
  deleteCredentialUseCase,
} from '@/lib/credentials/application/service-account'
import { executeCopilotCredentialUseCase } from '@/lib/mothership/application/execute-credential-use-case'

const mocks = {
  ...hoisted,
  getActor: credentialsAccessMockFns.mockGetCredentialActorContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  capture: posthogServerMockFns.mockCaptureServerEvent,
  environment: environmentUtilsMockFns.mockGetEffectiveDecryptedEnv,
}

const WORKSPACE_ID = 'workspace-1'
const workspace = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = createPersonalApiKeyPrincipal()
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
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID }),
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

  it('treats a concurrent disconnect as an idempotent success', async () => {
    mocks.deleteRecord.mockResolvedValue(false)

    const result = await deleteCredentialUseCase.execute({
      principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: credential.id },
    })

    expect(result).toEqual({ credential, deleted: false })
  })
})
