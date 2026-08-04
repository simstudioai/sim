/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRecordAudit,
  mockGetCredentialActorContext,
  mockDecryptSecret,
  mockVerifyAndBuildServiceAccountSecret,
  mockIsClientCredentialAccountProviderId,
} = vi.hoisted(() => ({
  mockRecordAudit: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockVerifyAndBuildServiceAccountSecret: vi.fn(),
  mockIsClientCredentialAccountProviderId: vi.fn(() => false),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_UPDATED: 'credential.updated' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mockRecordAudit,
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
  isClientCredentialAccountProviderId: mockIsClientCredentialAccountProviderId,
}))
vi.mock('@/lib/credentials/deletion', () => ({ deleteCredential: vi.fn() }))
vi.mock('@/lib/credentials/environment', () => ({
  deleteWorkspaceEnvCredentials: vi.fn(),
  syncPersonalEnvCredentialsForUser: vi.fn(),
}))
vi.mock('@/lib/credentials/atlassian-service-account', () => ({
  AtlassianValidationError: class AtlassianValidationError extends Error {},
}))
vi.mock('@/lib/credentials/token-service-accounts/errors', () => ({
  TokenServiceAccountValidationError: class TokenServiceAccountValidationError extends Error {},
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { performUpdateCredential } from '@/lib/credentials/orchestration'

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
    })

    expect(updatePayload()).not.toHaveProperty('displayName')
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

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
})
