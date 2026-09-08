/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
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

  it('lets an explicit displayName in the same request win over the derived one', async () => {
    mockCredential()
    mockStoredBlob({ type: 'service_account', client_email: OLD_EMAIL })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      displayName: 'Renamed by admin',
      serviceAccountJson: NEW_GOOGLE_KEY,
    })

    expect(updatePayload().displayName).toBe('Renamed by admin')
    // The stored blob is never read when the caller already named the credential.
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('leaves the label alone when the stored blob carries no recoverable identity', async () => {
    mockCredential({ providerId: 'atlassian-service-account', displayName: 'Acme Jira' })
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'atlassian-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'Other Site',
      auditMetadata: { atlassianCloudId: 'cloud-2' },
    })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      apiToken: 'tok',
      domain: 'other.atlassian.net',
      atlassianProduct: 'jira',
    })

    expect(updatePayload()).not.toHaveProperty('displayName')
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it.each(['confluence', 'jira', undefined] as const)(
    'preserves the saved Atlassian product on reconnect (%s)',
    async (product) => {
      mockCredential({ providerId: 'atlassian-service-account', displayName: 'Fixture Atlassian' })
      mockStoredBlob({ type: 'atlassian_service_account', atlassianProduct: product })
      await performUpdateCredential({
        credentialId: 'cred-1',
        userId: 'user-1',
        apiToken: 'new-token',
        domain: 'acme.atlassian.net',
      })
      expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
        'atlassian-service-account',
        expect.objectContaining({ atlassianProduct: product ?? 'jira' })
      )
    }
  )

  it('re-labels a Slack custom bot that still carries its previous team name', async () => {
    mockCredential({ providerId: 'slack-custom-bot', displayName: 'Old Team' })
    mockStoredBlob({ type: 'slack_custom_bot', teamName: 'Old Team', teamId: 'T1' })
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'slack-custom-bot',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'New Team',
      auditMetadata: { slackTeamId: 'T2' },
      botUserId: 'U2',
    })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      botToken: 'xoxb-new',
      signingSecret: 'sig',
    })

    expect(updatePayload().displayName).toBe('New Team')
  })

  it('merges the rebuilt secret audit metadata into the CREDENTIAL_UPDATED entry', async () => {
    mockCredential()
    mockStoredBlob({ type: 'service_account', client_email: OLD_EMAIL })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      serviceAccountJson: NEW_GOOGLE_KEY,
    })

    expect(auditMetadata()).toMatchObject({
      credentialType: 'service_account',
      principalKind: 'user',
      principalId: NEW_EMAIL,
    })
    expect(auditMetadata().updatedFields).toEqual(
      expect.arrayContaining(['displayName', 'encryptedServiceAccountKey'])
    )
  })

  it('never lets provider audit metadata shadow the orchestration keys', async () => {
    mockCredential({ providerId: 'atlassian-service-account', displayName: 'Acme Jira' })
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'atlassian-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'Acme Jira',
      auditMetadata: { credentialType: 'spoofed', updatedFields: 'spoofed' },
    })

    await performUpdateCredential({ credentialId: 'cred-1', userId: 'user-1', apiToken: 'tok' })

    expect(auditMetadata().credentialType).toBe('service_account')
    expect(auditMetadata().updatedFields).toEqual(['encryptedServiceAccountKey'])
  })

  it('omits secret audit metadata on a metadata-only update', async () => {
    mockCredential()

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      description: 'Billing exports',
    })

    expect(mockVerifyAndBuildServiceAccountSecret).not.toHaveBeenCalled()
    expect(auditMetadata()).toEqual({
      credentialType: 'service_account',
      updatedFields: ['description'],
    })
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

  it('does not read the stored blob for a single-grant client-credential reconnect', async () => {
    // Zoom/Box/Zoho have no auth method to carry forward, so a reconnect that
    // supplies its own dataCenter must not pay for a decrypt.
    mockCredential({ providerId: 'zoom-service-account', displayName: 'Zoom S2S' })
    mockIsClientCredentialAccountProviderId.mockReturnValue(true)
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'zoom-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'Zoom S2S',
      auditMetadata: {},
    })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      clientId: 'cid',
      clientSecret: 'csec',
      orgId: 'acct-1',
      dataCenter: 'us',
    })

    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('threads a NetSuite certificate ID through reconnect', async () => {
    mockCredential({
      providerId: 'netsuite-service-account',
      displayName: 'Production NetSuite',
    })
    mockIsClientCredentialAccountProviderId.mockReturnValue(true)
    mockVerifyAndBuildServiceAccountSecret.mockResolvedValue({
      providerId: 'netsuite-service-account',
      encryptedServiceAccountKey: 'new-cipher',
      displayName: 'Production NetSuite',
      auditMetadata: {},
    })

    await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      orgId: 'https://1234567.suitetalk.api.netsuite.com',
      clientId: 'client-id',
      certificateId: 'certificate-id',
      privateKey: '-----BEGIN PRIVATE KEY-----rotated',
    })

    expect(mockVerifyAndBuildServiceAccountSecret).toHaveBeenCalledWith(
      'netsuite-service-account',
      expect.objectContaining({ certificateId: 'certificate-id' })
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

describe('performUpdateCredential — description scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsClientCredentialAccountProviderId.mockReturnValue(false)
    mockGetClientCredentialAccountDescriptor.mockReturnValue(undefined)
  })

  it('applies a description to a workspace secret', async () => {
    mockCredential({ type: 'env_workspace', envKey: 'STRIPE_API_KEY', providerId: null })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      description: 'Prod billing key',
    })

    expect(result.success).toBe(true)
    expect(updatePayload().description).toBe('Prod billing key')
  })

  it('rejects a description on a personal secret instead of writing dead data', async () => {
    mockCredential({ type: 'env_personal', envKey: 'MY_TEST_KEY', providerId: null })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      description: 'invisible dead data',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.success ? '' : result.error).toMatch(/cannot have a description/)
  })
})

/**
 * Only a service-account credential has a secret blob to rotate into. Every
 * other type used to fall straight through the rotation branch, so a secret
 * sent alongside a rename was silently discarded behind a 200 — the caller
 * believing it had rotated something.
 */
describe('performUpdateCredential — secret fields on a non-rotatable credential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsClientCredentialAccountProviderId.mockReturnValue(false)
    mockGetClientCredentialAccountDescriptor.mockReturnValue(undefined)
  })

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

  it('names every submitted secret field so the caller knows what was refused', async () => {
    mockCredential({ type: 'env_workspace', envKey: 'STRIPE_API_KEY', providerId: null })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      apiToken: 'token',
      domain: 'example.atlassian.net',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.success ? '' : result.error).toMatch(/apiToken, domain/)
  })

  it('leaves a rename with no secret working on a non-service-account credential', async () => {
    mockCredential({ type: 'oauth', providerId: 'google' })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      displayName: 'Renamed',
    })

    expect(result.success).toBe(true)
    expect(updatePayload().displayName).toBe('Renamed')
  })
})

describe('performUpdateCredential — unredacted scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsClientCredentialAccountProviderId.mockReturnValue(false)
    mockGetClientCredentialAccountDescriptor.mockReturnValue(undefined)
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

  it.each(['oauth', 'env_personal', 'service_account'] as const)(
    'rejects the flag on a %s credential instead of writing dead data',
    async (type) => {
      mockCredential({ type, envKey: type === 'env_personal' ? 'MY_KEY' : null })

      const result = await performUpdateCredential({
        credentialId: 'cred-1',
        userId: 'user-1',
        unredacted: true,
      })

      expect(result).toMatchObject({
        success: false,
        errorCode: 'validation',
        error: 'Only workspace secrets can be marked visible (unredacted).',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(
        environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache
      ).not.toHaveBeenCalled()
    }
  )

  it('does not invalidate the environment cache for a pure description change', async () => {
    mockCredential({ type: 'env_workspace', envKey: 'STRIPE_API_KEY', providerId: null })

    const result = await performUpdateCredential({
      credentialId: 'cred-1',
      userId: 'user-1',
      description: 'Prod billing key',
    })

    expect(result.success).toBe(true)
    expect(updatePayload()).not.toHaveProperty('unredacted')
    expect(environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache).not.toHaveBeenCalled()
  })
})

describe('createServiceAccountCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.clearAllMocks()
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

  it('leaves the OAuth grant alone when the credential row was already gone', async () => {
    mockDeleteConnectionCredential.mockResolvedValueOnce(false)

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

    expect(deleted).toBe(false)
    expect(mockDeleteOrphanedOAuthAccount).not.toHaveBeenCalled()
  })

  it('does not touch OAuth grants for a service-account credential', async () => {
    mockDeleteConnectionCredential.mockResolvedValueOnce(true)

    await deleteCredentialRecord({
      credential: {
        id: 'cred-1',
        workspaceId: 'ws-1',
        type: 'service_account',
        providerId: 'google-service-account',
        accountId: 'acct-1',
      } as never,
      reason: 'user_delete',
    })

    expect(mockDeleteOrphanedOAuthAccount).not.toHaveBeenCalled()
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

  it('keeps the classified codes on their own statuses', () => {
    expect(statusForCredentialOrchestrationError('validation')).toBe(400)
    expect(statusForCredentialOrchestrationError('forbidden')).toBe(403)
    expect(statusForCredentialOrchestrationError('not_found')).toBe(404)
    expect(statusForCredentialOrchestrationError('conflict')).toBe(409)
    expect(statusForCredentialOrchestrationError(undefined)).toBe(500)
  })
})
