import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchSlackTeamId,
  mockValidateAtlassian,
  mockNormalizeDomain,
  mockClientCredentialMinter,
  mockVerifyAndEncryptOci,
} = vi.hoisted(() => ({
  mockFetchSlackTeamId: vi.fn(),
  mockValidateAtlassian: vi.fn(),
  mockNormalizeDomain: vi.fn((raw: string) => raw.trim().toLowerCase()),
  mockClientCredentialMinter: vi.fn(),
  mockVerifyAndEncryptOci: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
const mockEncryptSecret = encryptionMockFns.mockEncryptSecret
vi.mock('@/lib/webhooks/providers/slack', () => ({ fetchSlackTeamId: mockFetchSlackTeamId }))
vi.mock('@/lib/credentials/atlassian-service-account', () => ({
  validateAtlassianServiceAccount: mockValidateAtlassian,
  normalizeAtlassianDomain: mockNormalizeDomain,
}))
vi.mock('@/lib/credentials/oci-api-key-service-account.server', () => ({
  OciCredentialVerificationError: class OciCredentialVerificationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  verifyAndEncryptOciApiKeyCredential: mockVerifyAndEncryptOci,
}))
vi.mock('@/lib/api/contracts/credentials', () => ({
  serviceAccountJsonSchema: {
    safeParse: (value: string) => {
      try {
        const parsed = JSON.parse(value)
        return { success: true, data: parsed }
      } catch {
        return { success: false, error: { issues: [{ message: 'bad json' }] } }
      }
    },
  },
}))
vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('@/lib/credentials/client-credential-accounts/server', () => ({
  getClientCredentialAccountMinter: (providerId: string) =>
    providerId === 'zoom-service-account' ||
    providerId === 'box-service-account' ||
    providerId === 'netsuite-service-account'
      ? mockClientCredentialMinter
      : undefined,
}))

import {
  ServiceAccountSecretError,
  verifyAndBuildServiceAccountSecret,
} from '@/lib/credentials/service-account-secret'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'

describe('verifyAndBuildServiceAccountSecret', () => {
  beforeEach(() => {
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    mockNormalizeDomain.mockImplementation((raw: string) => raw.trim().toLowerCase())
  })

  it('verifies a Slack bot token and encrypts the derived blob', async () => {
    mockFetchSlackTeamId.mockResolvedValue({ teamId: 'T1', userId: 'U_BOT', teamName: 'Acme' })
    const result = await verifyAndBuildServiceAccountSecret(SLACK_CUSTOM_BOT_PROVIDER_ID, {
      signingSecret: 'sec',
      botToken: 'xoxb-1',
    })
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      signingSecret: 'sec',
      botToken: 'xoxb-1',
      teamId: 'T1',
      botUserId: 'U_BOT',
      teamName: 'Acme',
    })
  })

  it('verifies an Atlassian token and encrypts the blob', async () => {
    mockValidateAtlassian.mockResolvedValue({
      accountId: 'acc-1',
      displayName: 'Jira Bot',
      cloudId: 'cloud-1',
      emailAddress: 'bot@acme.com',
    })
    const result = await verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, {
      apiToken: 'tok',
      domain: 'Acme.atlassian.net',
      atlassianProduct: 'confluence',
    })
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      apiToken: 'tok',
      domain: 'acme.atlassian.net',
      cloudId: 'cloud-1',
      atlassianProduct: 'confluence',
    })
  })

  it('accepts a legacy Google create with an empty providerId', async () => {
    const json = JSON.stringify({
      type: 'service_account',
      client_email: 'svc@proj.iam',
      project_id: 'proj',
    })
    const result = await verifyAndBuildServiceAccountSecret('', { serviceAccountJson: json })
    expect(result.providerId).toBe('google-service-account')
  })

  it('verifies and stores an OCI API-key credential with stable external fields', async () => {
    mockVerifyAndEncryptOci.mockResolvedValue({
      encryptedServiceAccountKey: 'oci-ciphertext',
      userOcid: 'ocid1.user.oc1..principal',
    })

    const result = await verifyAndBuildServiceAccountSecret('oci-api-key-service-account', {
      tenancyOcid: 'ocid1.tenancy.oc1..tenant',
      userOcid: 'ocid1.user.oc1..principal',
      fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
      privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
      privateKeyPassphrase: ' preserved exactly ',
      region: 'us-ashburn-1',
    })

    expect(mockVerifyAndEncryptOci).toHaveBeenCalledWith({
      tenancyOcid: 'ocid1.tenancy.oc1..tenant',
      userOcid: 'ocid1.user.oc1..principal',
      fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
      privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
      privateKeyPassphrase: ' preserved exactly ',
      region: 'us-ashburn-1',
    })
    expect(result).toEqual({
      providerId: 'oci-api-key-service-account',
      encryptedServiceAccountKey: 'oci-ciphertext',
      displayName: 'ocid1.user.oc1..principal',
      auditMetadata: {
        principalKind: 'user',
        principalId: 'ocid1.user.oc1..principal',
      },
      principal: { kind: 'user', id: 'ocid1.user.oc1..principal' },
    })
  })

  it('requires the complete OCI signing tuple before verification', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret('oci-api-key-service-account', {
        tenancyOcid: 'ocid1.tenancy.oc1..tenant',
      })
    ).rejects.toThrow('tenancyOcid, userOcid, fingerprint, privateKey, and region are required')
    expect(mockVerifyAndEncryptOci).not.toHaveBeenCalled()
  })

  it.each(['service_unavailable', 'invalid_response'] as const)(
    'preserves the dedicated OCI %s classification for orchestration',
    async (code) => {
      const { OciCredentialVerificationError } = await import(
        '@/lib/credentials/oci-api-key-service-account.server'
      )
      mockVerifyAndEncryptOci.mockRejectedValue(new OciCredentialVerificationError(code))

      const failure = await verifyAndBuildServiceAccountSecret('oci-api-key-service-account', {
        tenancyOcid: 'ocid1.tenancy.oc1..tenant',
        userOcid: 'ocid1.user.oc1..principal',
        fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
        privateKey: 'provider-secret-key',
        region: 'us-ashburn-1',
      }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(OciCredentialVerificationError)
      expect(failure).toMatchObject({
        message: code,
        code,
      })
      expect(JSON.stringify(failure)).not.toContain('provider-secret-key')
    }
  )

  it('preserves the dedicated OCI invalid-credential classification for orchestration', async () => {
    const { OciCredentialVerificationError } = await import(
      '@/lib/credentials/oci-api-key-service-account.server'
    )
    mockVerifyAndEncryptOci.mockRejectedValue(
      new OciCredentialVerificationError('invalid_credentials')
    )

    await expect(
      verifyAndBuildServiceAccountSecret('oci-api-key-service-account', {
        tenancyOcid: 'ocid1.tenancy.oc1..tenant',
        userOcid: 'ocid1.user.oc1..principal',
        fingerprint: 'invalid-fingerprint',
        privateKey: 'invalid-key',
        region: 'us-ashburn-1',
      })
    ).rejects.toMatchObject({ message: 'invalid_credentials', code: 'invalid_credentials' })
  })

  it('does not misclassify an internal OCI credential failure as rejected credentials', async () => {
    const internalFailure = new Error('internal encryption failure')
    mockVerifyAndEncryptOci.mockRejectedValue(internalFailure)

    await expect(
      verifyAndBuildServiceAccountSecret('oci-api-key-service-account', {
        tenancyOcid: 'ocid1.tenancy.oc1..tenant',
        userOcid: 'ocid1.user.oc1..principal',
        fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
        privateKey: 'provider-secret-key',
        region: 'us-ashburn-1',
      })
    ).rejects.toBe(internalFailure)
  })

  it('rejects an unknown non-empty providerId instead of persisting it as Google', async () => {
    const json = JSON.stringify({ type: 'service_account', client_email: 'svc@proj.iam' })
    await expect(
      verifyAndBuildServiceAccountSecret('hubspot-service-acount-typo', {
        serviceAccountJson: json,
      })
    ).rejects.toThrow('Unsupported service-account provider')
  })

  it('dispatches a client-credential provider to the minter and encrypts the blob', async () => {
    mockClientCredentialMinter.mockResolvedValue({
      accessToken: 'minted',
      expiresInSeconds: 3600,
      identity: {
        displayName: 'Zoom account acc-1',
        principal: { kind: 'tenant', id: 'acc-1' },
        auditMetadata: { zoomAccountId: 'acc-1' },
        storedMetadata: { apiUrl: 'https://api.zoom.us' },
      },
    })
    const result = await verifyAndBuildServiceAccountSecret('zoom-service-account', {
      clientId: ' cid ',
      clientSecret: ' csec ',
      orgId: ' acc-1 ',
    })
    expect(mockClientCredentialMinter).toHaveBeenCalledWith({
      clientId: 'cid',
      clientSecret: 'csec',
      orgId: 'acc-1',
    })
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toEqual({
      type: 'client_credential_account',
      providerId: 'zoom-service-account',
      clientId: 'cid',
      clientSecret: 'csec',
      orgId: 'acc-1',
      metadata: {
        apiUrl: 'https://api.zoom.us',
        principalKind: 'tenant',
        principalId: 'acc-1',
      },
    })
  })

  it('threads NetSuite certificate material into the minter and encrypted blob', async () => {
    mockClientCredentialMinter.mockResolvedValue({
      accessToken: 'minted',
      expiresInSeconds: 3600,
      instanceUrl: 'https://1234567.suitetalk.api.netsuite.com',
      identity: {
        displayName: 'Oracle NetSuite 1234567',
        principal: { kind: 'tenant', id: '1234567' },
        auditMetadata: { netSuiteAccountId: '1234567' },
      },
    })

    const result = await verifyAndBuildServiceAccountSecret('netsuite-service-account', {
      orgId: ' https://1234567.suitetalk.api.netsuite.com/ ',
      clientId: ' client-id ',
      certificateId: ' certificate-id ',
      privateKey: ' -----BEGIN PRIVATE KEY-----key ',
    })
    expect(JSON.parse(result.encryptedServiceAccountKey)).toMatchObject({
      providerId: 'netsuite-service-account',
      certificateId: 'certificate-id',
      privateKey: '-----BEGIN PRIVATE KEY-----key',
    })
  })

  it('throws when client-credential required fields are missing, without minting', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret('zoom-service-account', {
        clientId: 'cid',
        clientSecret: 'csec',
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    expect(mockClientCredentialMinter).not.toHaveBeenCalled()
  })
  it('rejects prototype-chain providerIds with a validation error, not a TypeError', async () => {
    for (const providerId of ['__proto__', 'constructor', 'toString']) {
      await expect(
        verifyAndBuildServiceAccountSecret(providerId, { serviceAccountJson: '{}' })
      ).rejects.toThrow('Unsupported service-account provider')
    }
  })
})
