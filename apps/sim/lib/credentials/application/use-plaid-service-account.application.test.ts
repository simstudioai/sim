/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolvePermission: vi.fn(),
  resolveContext: vi.fn(),
  getActor: vi.fn(),
  decryptCredential: vi.fn(),
  executeProvider: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_ACCESSED: 'credential.accessed' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getActor,
}))
vi.mock('@/lib/credentials/application/credential-context', () => ({
  resolveCredentialApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/credentials/plaid-service-account', () => ({
  decryptPlaidServiceAccountCredential: mocks.decryptCredential,
}))
vi.mock('@/tools/plaid/utils.server', () => ({
  executePlaidProviderRequest: mocks.executeProvider,
}))

import { usePlaidServiceAccount } from '@/lib/credentials/application/use-plaid-service-account'

const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'service_account',
  providerId: 'plaid-service-account',
  encryptedServiceAccountKey: 'encrypted',
}
const stored = {
  type: 'plaid_service_account',
  providerId: 'plaid-service-account',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  environment: 'production',
  accessToken: 'item-token',
  itemId: 'item-1',
  metadata: {},
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:credentials',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
}

describe('usePlaidServiceAccount application composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      credential,
    })
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'member', status: 'active' },
      hasWorkspaceAccess: true,
      isAdmin: false,
    })
    mocks.decryptCredential.mockResolvedValue(stored)
    mocks.executeProvider.mockResolvedValue({ accounts: [] })
  })

  it('authorizes, validates Plaid custody, executes the provider request, and audits projection', async () => {
    const signal = new AbortController().signal
    const body = {
      operation: 'plaid_get_accounts' as const,
      credentialId: 'credential-1',
      input: {},
    }

    await expect(
      usePlaidServiceAccount.execute({ principal, input: { body, signal } })
    ).resolves.toEqual({ accounts: [] })

    expect(mocks.resolveContext).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.getActor).toHaveBeenCalledWith('credential-1', 'user-1')
    expect(mocks.decryptCredential).toHaveBeenCalledWith(credential)
    expect(mocks.executeProvider).toHaveBeenCalledWith({ body, credential: stored, signal })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        action: 'credential.accessed',
        resourceType: 'credential',
        resourceId: 'credential-1',
        metadata: expect.objectContaining({
          provider: 'plaid-service-account',
          credentialType: 'service_account',
          toolId: 'plaid_get_accounts',
          operation: 'credentials.service_accounts.use',
        }),
      })
    )
  })
})
