import {
  auditMock,
  dbChainMockFns,
  environmentUtilsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRecordAudit,
  mockGetCredentialActorContext,
  mockDecryptSecret,
  mockVerifyAndBuildServiceAccountSecret,
  mockIsClientCredentialAccountProviderId,
  mockGetClientCredentialAccountDescriptor,
  mockDeleteConnectionCredential,
  mockDeleteOrphanedOAuthAccount,
  mockDeleteWorkspaceEnvCredentials,
  mockDeletePersonalEnvCredentialForUser,
} = vi.hoisted(() => ({
  mockRecordAudit: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockVerifyAndBuildServiceAccountSecret: vi.fn(),
  mockIsClientCredentialAccountProviderId: vi.fn(() => false),
  // Only a descriptor carrying `defaultAuthMethod` is multi-grant; single-grant
  // providers must not trigger the stored-blob read for authMethod/username.
  mockGetClientCredentialAccountDescriptor: vi.fn(() => undefined),
  mockDeleteConnectionCredential: vi.fn(),
  mockDeleteOrphanedOAuthAccount: vi.fn(),
  mockDeleteWorkspaceEnvCredentials: vi.fn(),
  mockDeletePersonalEnvCredentialForUser: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_UPDATED: 'credential.updated' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mockRecordAudit,
  auditUpdatedFields: auditMock.auditUpdatedFields,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
}))
vi.mock('@/lib/credential-groups/provider-configuration', () => ({
  listSlackCredentialGroupConfigurationsForBot: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/credential-groups/slack-managed-users', () => ({
  verifySlackCustomBotAppIdentity: vi.fn(),
  SlackManagedUsersError: class extends Error {},
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mockDecryptSecret }))
vi.mock('@/lib/credentials/service-account-secret', () => ({
  verifyAndBuildServiceAccountSecret: mockVerifyAndBuildServiceAccountSecret,
  ServiceAccountSecretError: class ServiceAccountSecretError extends Error {},
}))
vi.mock('@/lib/credentials/client-credential-accounts/descriptors', () => ({
  CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS: {},
  isClientCredentialAccountProviderId: mockIsClientCredentialAccountProviderId,
  getClientCredentialAccountDescriptor: mockGetClientCredentialAccountDescriptor,
}))
vi.mock('@/lib/credentials/deletion', () => ({
  deleteConnectionCredential: mockDeleteConnectionCredential,
  deleteOrphanedOAuthAccount: mockDeleteOrphanedOAuthAccount,
}))
vi.mock('@/lib/credentials/environment', () => ({
  deleteWorkspaceEnvCredentials: mockDeleteWorkspaceEnvCredentials,
  deletePersonalEnvCredentialForUser: mockDeletePersonalEnvCredentialForUser,
}))
vi.mock('@/lib/credentials/atlassian-service-account', () => ({
  AtlassianValidationError: class AtlassianValidationError extends Error {},
}))
vi.mock('@/lib/credentials/token-service-accounts/errors', () => ({
  TokenServiceAccountValidationError: class TokenServiceAccountValidationError extends Error {},
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import {
  createServiceAccountCredential,
  deleteCredentialRecord,
  performUpdateCredential,
  statusForCredentialOrchestrationError,
} from '@/lib/credentials/orchestration'

const OLD_EMAIL = 'old-sa@old-project.iam.gserviceaccount.com'
const NEW_EMAIL = 'new-sa@new-project.iam.gserviceaccount.com'

const NEW_GOOGLE_KEY = JSON.stringify({
  type: 'service_account',
  client_email: NEW_EMAIL,
  private_key: 'pk',
  project_id: 'new-project',
})

/** Points `getCredentialActorContext` at an admin-accessible credential row. */
function mockCredential(overrides: Record<string, unknown> = {}) {
  mockGetCredentialActorContext.mockResolvedValue({
    credential: {
      id: 'cred-1',
      workspaceId: 'ws-1',
      type: 'service_account',
      providerId: 'google-service-account',
      displayName: OLD_EMAIL,
      ...overrides,
    },
    hasWorkspaceAccess: true,
    isAdmin: true,
  })
}

/** Queues the stored (pre-rotation) secret blob for the orchestration's read. */
function mockStoredBlob(blob: unknown) {
  queueTableRows(schemaMock.credential, [{ key: 'stored-cipher' }])
  mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(blob) })
}

/**
 * The `set(...)` payload of the credential UPDATE — always the first mutation,
 * ahead of the Slack bot-user-id propagation to webhooks.
 */
function updatePayload(): Record<string, unknown> {
  const call = dbChainMockFns.set.mock.calls[0]
  return (call?.[0] ?? {}) as Record<string, unknown>
}

/** The metadata recorded on the CREDENTIAL_UPDATED audit entry. */
function auditMetadata(): Record<string, unknown> {
  const call = mockRecordAudit.mock.calls.at(-1)
  return ((call?.[0] as { metadata?: Record<string, unknown> })?.metadata ?? {}) as Record<
    string,
    unknown
  >
}

describe('performUpdateCredential — service-account secret rotation', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockIsClientCredentialAccountProviderId.mockReturnValue(false)
    mockGetClientCredentialAccountDescriptor.mockReturnValue(undefined)
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'google-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: NEW_EMAIL,
      auditMetadata: { principalKind: 'user', principalId: NEW_EMAIL },
    })
  })

  it('re-labels a Google credential whose name is still the previous key identity', async () => {
    mockCredential()
    mockStoredBlob({ type: 'service_account', client_email: OLD_EMAIL })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      serviceAccountJson: NEW_GOOGLE_KEY,
    })

    expect(result.success).toBe(true)
    expect(updatePayload().displayName).toBe(NEW_EMAIL)
    expect(updatePayload().encryptedServiceAccountKey).toBe('new-cipher')
    expect(result.updatedFields).toContain('displayName')
    expect(result.previousDisplayName).toBe(OLD_EMAIL)
  })

  it('keeps a label the user typed instead of the derived identity', async () => {
    mockCredential({ displayName: 'Prod billing exporter' })
    mockStoredBlob({ type: 'service_account', client_email: OLD_EMAIL })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      serviceAccountJson: NEW_GOOGLE_KEY,
    })

    expect(result.success).toBe(true)
    expect(updatePayload()).not.toHaveProperty('displayName')
    expect(result.updatedFields).not.toContain('displayName')
  })

  it('preserves the saved Atlassian product on reconnect', async () => {
    mockCredential({ providerId: 'atlassian-service-account', displayName: 'Fixture Atlassian' })
    mockStoredBlob({ type: 'atlassian_service_account', atlassianProduct: 'confluence' })
    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      apiToken: 'new-token',
      domain: 'acme.atlassian.net',
    })
    expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
      'atlassian-service-account',
      expect.objectContaining({ atlassianProduct: 'confluence' })
    )
  })

  it('carries the stored dataCenter forward for a client-credential reconnect', async () => {
    mockCredential({ providerId: 'zoho-desk-service-account', displayName: 'Acme Desk' })
    mockIsClientCredentialAccountProviderId.mockReturnValue(true)
    mockStoredBlob({ type: 'client_credential_account', dataCenter: 'eu' })
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'zoho-desk-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'Acme Desk',
      auditMetadata: { zohoOrgId: 'org-1' },
    })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      clientId: 'cid',
      clientSecret: 'csec',
      orgId: 'org-1',
    })

    expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
      'zoho-desk-service-account',
      expect.objectContaining({ dataCenter: 'eu' })
    )
  })

  it('fails the reconnect when the stored secret cannot be decrypted', async () => {
    mockCredential()
    queueTableRows(schemaMock.credential, [{ key: 'stored-cipher' }])
    mockDecryptSecret.mockRejectedValue(new Error('decrypt failed'))

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      serviceAccountJson: NEW_GOOGLE_KEY,
    })

    expect(result).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockVerifyAndBuildServiceAccountSecret).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('carries the stored auth method and username forward on a key rotation', async () => {
    // Rotating a Salesforce JWT key resubmits only the key. Losing the stored
    // grant would silently mint the credential as client credentials instead.
    mockCredential({ providerId: 'salesforce-service-account', displayName: 'SF integration' })
    mockIsClientCredentialAccountProviderId.mockReturnValue(true)
    mockGetClientCredentialAccountDescriptor.mockReturnValue({
      defaultAuthMethod: 'client_credentials',
    } as never)
    mockStoredBlob({
      type: 'client_credential_account',
      authMethod: 'jwt_bearer',
      username: 'integration.user@acme.com',
    })
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'salesforce-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'SF integration',
      auditMetadata: {},
    })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      clientId: 'cid',
      orgId: 'acme.my.salesforce.com',
      privateKey: '-----BEGIN PRIVATE KEY-----rotated',
    })

    expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
      'salesforce-service-account',
      expect.objectContaining({
        authMethod: 'jwt_bearer',
        username: 'integration.user@acme.com',
        privateKey: '-----BEGIN PRIVATE KEY-----rotated',
      })
    )
  })

  it('surfaces a rebuild failure as a validation error and writes nothing', async () => {
    mockCredential()
    mockStoredBlob({ type: 'service_account', client_email: OLD_EMAIL })
    const { ServiceAccountSecretError } = await import('@/lib/credentials/service-account-secret')
    mockVerifyAndBuildServiceAccountSecret.mockRejectedValue(
      new ServiceAccountSecretError('Invalid service account JSON')
    )

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      serviceAccountJson: '{}',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('conceals managed OAuth credentials from the ordinary update path', async () => {
    mockCredential({ type: 'managed_oauth' })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      description: 'should not update',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'not_found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('performUpdateCredential — type-scoped fields', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockIsClientCredentialAccountProviderId.mockReturnValue(false)
    mockGetClientCredentialAccountDescriptor.mockReturnValue(undefined)
  })

  /**
   * Only a service-account credential has a secret blob to rotate into; a secret
   * sent for any other type used to be silently discarded behind a 200.
   */
  it('rejects a secret sent for an oauth credential rather than dropping it', async () => {
    mockCredential({ type: 'oauth', providerId: 'google' })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      displayName: 'Renamed',
      apiToken: 'token-that-would-vanish',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.success ? '' : result.error).toMatch(/apiToken/)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(mockVerifyAndBuildServiceAccountSecret).not.toHaveBeenCalled()
  })

  it('applies the flag to a workspace secret and invalidates its environment cache', async () => {
    mockCredential({ type: 'env_workspace', envKey: 'STRIPE_API_KEY', providerId: null })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      unredacted: true,
    })

    expect(result.success).toBe(true)
    expect(updatePayload().unredacted).toBe(true)
    expect(result.updatedFields).toContain('unredacted')
    expect(auditMetadata().unredacted).toBe(true)
    expect(environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
    })
  })

  it('rejects the unredacted flag on a non-workspace secret instead of writing dead data', async () => {
    mockCredential({ type: 'env_personal', envKey: 'MY_KEY' })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      unredacted: true,
    })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('createServiceAccountCredential', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('rejects an existing service-account source instead of discarding the submitted secret', async () => {
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'zoom-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'Production Zoom',
      auditMetadata: {},
      principal: { kind: 'tenant', id: 'account-1' },
    })
    queueTableRows(schemaMock.credential, [
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'service_account',
        providerId: 'zoom-service-account',
        displayName: 'Production Zoom',
        encryptedServiceAccountKey: 'old-cipher',
      },
    ])
    mockDecryptSecret
      .mockResolvedValueOnce({ decrypted: 'stored-secret' })
      .mockResolvedValueOnce({ decrypted: 'rotated-secret' })
    mockGetCredentialActorContext.mockResolvedValue({ member: { role: 'admin' }, isAdmin: true })

    const result = await createServiceAccountCredential({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      providerId: 'zoom-service-account',
      displayName: 'Production Zoom',
      clientId: 'client-id',
      clientSecret: 'rotated-client-secret',
      orgId: 'account-1',
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'conflict',
      providerErrorCode: 'duplicate_display_name',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockGetCredentialActorContext).toHaveBeenCalledWith('credential-1', 'user-1', {})
  })

  it('returns an accessible credential for an exact non-token secret replay', async () => {
    const existingCredential = {
      id: 'credential-1',
      workspaceId: 'workspace-1',
      type: 'service_account',
      providerId: 'zoom-service-account',
      displayName: 'Production Zoom',
      encryptedServiceAccountKey: 'stored-cipher',
    }
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'zoom-service-account',
      encryptedServiceAccountKey: 'replay-cipher',
      displayName: 'Production Zoom',
      auditMetadata: {},
      principal: { kind: 'tenant', id: 'account-1' },
    })
    queueTableRows(schemaMock.credential, [existingCredential])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'same-secret' })
    mockGetCredentialActorContext.mockResolvedValue({ member: { role: 'admin' }, isAdmin: true })

    const result = await createServiceAccountCredential({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      providerId: 'zoom-service-account',
      displayName: 'Production Zoom',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      orgId: 'account-1',
    })

    expect(result).toMatchObject({
      success: true,
      credential: existingCredential,
      created: false,
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('deleteCredentialRecord', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('rejects deleting a custom Slack bot used by an active Credential Group', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'group-1' }])

    await expect(
      deleteCredentialRecord({
        credential: {
          id: 'cred-1',
          workspaceId: 'ws-1',
          type: 'service_account',
          providerId: 'slack-custom-bot',
        } as never,
        reason: 'user_delete',
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Remove this custom Slack bot from its Credential Groups before deleting it.',
    })
    expect(mockDeleteConnectionCredential).not.toHaveBeenCalled()
  })

  /**
   * The whole variables map is read, edited and written back here, so a
   * concurrent secret write is lost unless this holds the same advisory lock
   * every other writer of that map takes.
   */
  it('removes a workspace env value under the map lock, with the row', async () => {
    await deleteCredentialRecord({
      credential: {
        id: 'cred-1',
        workspaceId: 'ws-1',
        type: 'env_workspace',
        envKey: 'STRIPE_API_KEY',
        providerId: null,
      } as never,
      reason: 'user_delete',
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    const locked = dbChainMockFns.execute.mock.calls.some(([statement]) => {
      const { sql, params } = (
        statement as { toSQL: () => { sql: string; params: unknown[] } }
      ).toSQL()
      return sql.includes('pg_advisory_xact_lock') && params.includes('ws-1')
    })
    expect(locked).toBe(true)
    // Passed the transaction, so the row cannot outlive the value it describes.
    expect(mockDeleteWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', removedKeys: ['STRIPE_API_KEY'] })
    )
    expect(mockDeleteWorkspaceEnvCredentials.mock.calls[0][0].executor).toBeDefined()
  })

  it('removes a personal env value under the map lock', async () => {
    await deleteCredentialRecord({
      credential: {
        id: 'cred-1',
        workspaceId: 'ws-1',
        type: 'env_personal',
        envKey: 'MY_KEY',
        envOwnerUserId: 'user-1',
        providerId: null,
      } as never,
      reason: 'user_delete',
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    const locked = dbChainMockFns.execute.mock.calls.some(([statement]) => {
      const { sql, params } = (
        statement as { toSQL: () => { sql: string; params: unknown[] } }
      ).toSQL()
      return sql.includes('pg_advisory_xact_lock') && params.includes('user-1')
    })
    expect(locked).toBe(true)
    /**
     * Targeted, not a reconcile against a key list: a list read before the
     * prune can miss a secret added since, and prune that secret's mirror
     * while its value survives.
     */
    expect(mockDeletePersonalEnvCredentialForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', envKey: 'MY_KEY' })
    )
    expect(mockDeletePersonalEnvCredentialForUser.mock.calls[0][0].executor).toBeDefined()
  })

  it('revokes the backing OAuth grant of a deleted oauth credential', async () => {
    mockDeleteConnectionCredential.mockResolvedValueOnce(true)

    const deleted = await deleteCredentialRecord({
      credential: {
        id: 'cred-1',
        workspaceId: 'ws-1',
        type: 'oauth',
        providerId: 'google-email',
        accountId: 'acct-1',
      } as never,
      reason: 'user_delete',
    })

    expect(deleted).toBe(true)
    expect(mockDeleteOrphanedOAuthAccount).toHaveBeenCalledWith('acct-1')
  })
})

describe('statusForCredentialOrchestrationError', () => {
  /**
   * `PROVIDER_OUTAGE_CODES` twelve lines above it already says both outage
   * families "must map to 503, not 400"; this returned 502, so the shared
   * status helper disagreed with its own neighbouring contract.
   */
  it('maps a provider outage to 503, matching the outage-code contract', () => {
    expect(statusForCredentialOrchestrationError(undefined, { providerUnavailable: true })).toBe(
      503
    )
    expect(statusForCredentialOrchestrationError('validation', { providerUnavailable: true })).toBe(
      503
    )
  })
})
