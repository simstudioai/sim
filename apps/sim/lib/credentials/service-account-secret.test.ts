import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchSlackTeamId,
  mockValidateAtlassian,
  mockNormalizeDomain,
  mockClientCredentialMinter,
  mockVerifyAndEncryptOci,
  mockPostgresqlQuery,
} = vi.hoisted(() => ({
  mockFetchSlackTeamId: vi.fn(),
  mockValidateAtlassian: vi.fn(),
  mockNormalizeDomain: vi.fn((raw: string) => raw.trim().toLowerCase()),
  mockClientCredentialMinter: vi.fn(),
  mockVerifyAndEncryptOci: vi.fn(),
  mockPostgresqlQuery: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
/** One stored token per application, served until it is invalidated, as the coordinated store does. */
const storedCoordinatedTokens = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/credentials/coordinated-client-token', () => ({
  resolveCoordinatedClientToken: async (input: {
    namespace: string
    application: readonly string[]
    exchange: () => Promise<{ accessToken: string; expiresAt: Date }>
  }) => {
    const key = `${input.namespace}:${input.application.join(':')}`
    const stored = storedCoordinatedTokens.get(key)
    if (stored) return { accessToken: stored, expiresInSeconds: 86_000 }
    const exchanged = await input.exchange()
    storedCoordinatedTokens.set(key, exchanged.accessToken)
    return { accessToken: exchanged.accessToken, expiresInSeconds: 86_000 }
  },
  invalidateCoordinatedClientToken: async (accessToken: string) => {
    for (const [key, stored] of storedCoordinatedTokens) {
      if (stored === accessToken) storedCoordinatedTokens.delete(key)
    }
  },
}))
const mockEncryptSecret = encryptionMockFns.mockEncryptSecret
vi.mock('@/lib/webhooks/providers/slack', () => ({ fetchSlackTeamId: mockFetchSlackTeamId }))
vi.mock('@/lib/credentials/atlassian-service-account', async (importOriginal) => ({
  AtlassianValidationError: (
    await importOriginal<typeof import('@/lib/credentials/atlassian-service-account')>()
  ).AtlassianValidationError,
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
vi.mock('@/lib/internal/postgresql/operations', () => ({
  executePostgresqlQuery: mockPostgresqlQuery,
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
    providerId === 'netsuite-service-account' ||
    providerId === 'oracle-epm-service-account' ||
    providerId === 'oracle-fusion-service-account' ||
    providerId === 'zendesk-service-account'
      ? mockClientCredentialMinter
      : undefined,
}))

import { AtlassianValidationError } from '@/lib/credentials/atlassian-service-account'
import {
  ServiceAccountSecretError,
  verifyAndBuildServiceAccountSecret,
} from '@/lib/credentials/service-account-secret'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'

beforeEach(() => {
  storedCoordinatedTokens.clear()
})

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

  it.each([
    ['an expiring bot token', 'xoxe.xoxb-1-abc'],
    ['a refresh token', 'xoxe-1-abc'],
  ])('refuses %s from token rotation, which Sim cannot refresh', async (_case, botToken) => {
    mockFetchSlackTeamId.mockResolvedValue({ teamId: 'T1', userId: 'U_BOT', teamName: 'Acme' })

    await expect(
      verifyAndBuildServiceAccountSecret(SLACK_CUSTOM_BOT_PROVIDER_ID, {
        signingSecret: 'sec',
        botToken,
      })
    ).rejects.toThrow('token rotation')
  })

  it('verifies an Atlassian token and encrypts the blob', async () => {
    mockValidateAtlassian.mockResolvedValue({
      accountId: 'acc-1',
      displayName: 'Jira Bot',
      cloudId: 'cloud-1',
      emailAddress: 'bot@acme.com',
    })
    const result = await verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, {
      apiToken: ' tok\n',
      domain: 'Acme.atlassian.net',
      atlassianProduct: 'confluence',
    })
    expect(mockValidateAtlassian).toHaveBeenCalledWith('tok', 'acme.atlassian.net', 'confluence')
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      apiToken: 'tok',
      domain: 'acme.atlassian.net',
      cloudId: 'cloud-1',
      atlassianProduct: 'confluence',
    })
  })

  it('stores an Atlassian OAuth 2.0 credential, not its minted token, after proving it', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(Response.json({ access_token: 'atl-minted', expires_in: 3600 }))
    mockValidateAtlassian.mockResolvedValue({
      accountId: 'svc-1',
      displayName: 'Workflow bot',
      cloudId: 'cloud-1',
    })

    const result = await verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, {
      authMethod: 'client_credentials',
      clientId: 'atl-client',
      clientSecret: 'atl-secret',
      domain: 'Acme.atlassian.net',
      atlassianProduct: 'confluence',
    })

    expect(mockValidateAtlassian).toHaveBeenCalledWith(
      'atl-minted',
      'acme.atlassian.net',
      'confluence'
    )
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      type: 'atlassian_service_account',
      authMethod: 'client_credentials',
      clientId: 'atl-client',
      clientSecret: 'atl-secret',
      domain: 'acme.atlassian.net',
      cloudId: 'cloud-1',
      atlassianProduct: 'confluence',
      atlassianAccountId: 'svc-1',
    })
    expect(blob.apiToken).toBeUndefined()
    expect(result.encryptedServiceAccountKey).not.toContain('atl-minted')
  })

  it('replaces a shared Atlassian token the site rejects, once', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(async () =>
      Response.json({ access_token: `atl-${fetchMock.mock.calls.length}`, expires_in: 3600 })
    )
    mockValidateAtlassian.mockImplementation(async (token: string) => {
      if (token !== 'atl-2') throw new AtlassianValidationError('invalid_credentials', 401)
      return { accountId: 'svc-1', displayName: 'Workflow bot', cloudId: 'cloud-1' }
    })
    const fields = {
      authMethod: 'client_credentials',
      clientId: 'atl-client',
      clientSecret: 'atl-secret',
      domain: 'acme.atlassian.net',
    }

    await expect(
      verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, fields)
    ).resolves.toMatchObject({ displayName: 'Workflow bot' })

    mockValidateAtlassian.mockRejectedValue(
      new AtlassianValidationError('invalid_credentials', 401)
    )
    await expect(
      verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, fields)
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not mint again when the Atlassian site is unavailable', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(Response.json({ access_token: 'atl-minted', expires_in: 3600 }))
    mockValidateAtlassian.mockRejectedValue(
      new AtlassianValidationError('atlassian_unavailable', 503)
    )

    await expect(
      verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, {
        authMethod: 'client_credentials',
        clientId: 'atl-client',
        clientSecret: 'atl-secret',
        domain: 'acme.atlassian.net',
      })
    ).rejects.toMatchObject({ code: 'atlassian_unavailable' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('requires the Atlassian client ID, secret, and site without minting', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, {
        authMethod: 'client_credentials',
        clientId: 'atl-client',
        domain: 'acme.atlassian.net',
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('stores only the Zendesk sign-in the selected method uses', async () => {
    mockClientCredentialMinter.mockResolvedValue({
      accessToken: 'encoded',
      expiresInSeconds: 3600,
      authStyle: 'basic',
      domain: 'acme',
      identity: {
        displayName: 'Zendesk acme',
        principal: { kind: 'user', id: '42' },
        auditMetadata: {},
      },
    })
    const submitted = {
      orgId: 'acme',
      clientId: 'leftover-client',
      clientSecret: 'leftover-secret',
      scope: 'read',
      username: ' agent@example.com ',
      apiToken: ' zendesk-api-token ',
    }

    const apiToken = await verifyAndBuildServiceAccountSecret('zendesk-service-account', {
      ...submitted,
      authMethod: 'api_token',
    })
    const tokenBlob = JSON.parse(apiToken.encryptedServiceAccountKey)
    expect(tokenBlob).toMatchObject({
      authMethod: 'api_token',
      orgId: 'acme',
      username: 'agent@example.com',
      apiToken: 'zendesk-api-token',
    })
    expect(tokenBlob.clientSecret).toBeUndefined()
    expect(tokenBlob.scope).toBeUndefined()

    const client = await verifyAndBuildServiceAccountSecret('zendesk-service-account', submitted)
    const clientBlob = JSON.parse(client.encryptedServiceAccountKey)
    expect(clientBlob).toMatchObject({
      authMethod: 'client_credentials',
      clientId: 'leftover-client',
      clientSecret: 'leftover-secret',
      scope: 'read',
    })
    expect(clientBlob.apiToken).toBeUndefined()
    expect(clientBlob.username).toBeUndefined()
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

  it('encrypts only the Oracle Fusion fields and captures no unverified principal', async () => {
    mockClientCredentialMinter.mockResolvedValue({
      accessToken: 'opaque-basic',
      expiresInSeconds: 300,
      instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
      identity: {
        displayName: 'Oracle Fusion vision',
        principal: null,
        auditMetadata: {
          oracleFusionApplicationOrigin: 'https://vision.fa.us2.oraclecloud.com',
        },
        storedMetadata: { applicationOrigin: 'https://vision.fa.us2.oraclecloud.com' },
      },
    })

    const result = await verifyAndBuildServiceAccountSecret('oracle-fusion-service-account', {
      orgId: ' https://vision.fa.us2.oraclecloud.com/ ',
      clientId: ' integration-user ',
      clientSecret: ' password ',
      certificateId: 'discard-me',
      authMethod: 'discard-me',
      privateKey: 'discard-me',
      username: 'discard-me',
    })

    expect(mockClientCredentialMinter).toHaveBeenCalledWith({
      orgId: 'https://vision.fa.us2.oraclecloud.com/',
      clientId: 'integration-user',
      clientSecret: ' password ',
      certificateId: undefined,
      dataCenter: undefined,
      authMethod: undefined,
      privateKey: undefined,
      username: undefined,
    })
    expect(result).toMatchObject({
      displayName: 'Oracle Fusion vision',
      principal: null,
      auditMetadata: {
        oracleFusionApplicationOrigin: 'https://vision.fa.us2.oraclecloud.com',
        principalKind: 'none',
      },
    })
    expect(JSON.parse(result.encryptedServiceAccountKey)).toEqual({
      type: 'client_credential_account',
      providerId: 'oracle-fusion-service-account',
      clientId: 'integration-user',
      clientSecret: ' password ',
      orgId: 'https://vision.fa.us2.oraclecloud.com/',
      metadata: {
        applicationOrigin: 'https://vision.fa.us2.oraclecloud.com',
        principalKind: 'none',
      },
    })
  })

  it('stores the Oracle EPM environment and integration-user secret through the generic path', async () => {
    mockClientCredentialMinter.mockResolvedValue({
      accessToken: 'basic-token',
      expiresInSeconds: 600,
      instanceUrl: 'https://epm.example.com/gateway',
      identity: {
        displayName: 'Oracle EPM epm.example.com',
        principal: null,
        auditMetadata: { environmentUrl: 'https://epm.example.com/gateway' },
        storedMetadata: { environmentUrl: 'https://epm.example.com/gateway' },
      },
    })
    const result = await verifyAndBuildServiceAccountSecret('oracle-epm-service-account', {
      orgId: ' https://epm.example.com/gateway ',
      clientId: ' integration.user@example.com ',
      clientSecret: ' password ',
    })

    expect(mockClientCredentialMinter).toHaveBeenCalledWith({
      orgId: 'https://epm.example.com/gateway',
      clientId: 'integration.user@example.com',
      clientSecret: ' password ',
    })
    expect(JSON.parse(result.encryptedServiceAccountKey)).toMatchObject({
      providerId: 'oracle-epm-service-account',
      orgId: 'https://epm.example.com/gateway',
      clientId: 'integration.user@example.com',
      clientSecret: ' password ',
      metadata: { environmentUrl: 'https://epm.example.com/gateway' },
    })
    expect(result.principal).toBeNull()
  })

  it.each([
    [
      'aws-service-account',
      { authType: 'oidc_role', roleArn: 'arn:aws:iam::123456789012:role/SimWorkflows' },
      'Use access keys.',
    ],
    [
      'databricks-service-account',
      {
        authType: 'oidc_federation',
        host: 'dbc-abc123.cloud.databricks.com',
        clientId: '11111111-2222-3333-4444-555555555555',
      },
      'Use a personal access token or a service principal OAuth secret.',
    ],
    [
      'snowflake-service-account',
      { authType: 'workload_identity', host: 'myorg-myaccount.snowflakecomputing.com' },
      'Use a programmatic access token.',
    ],
    [
      'microsoft-app-service-account',
      {
        authType: 'federated',
        tenantId: '11111111-2222-3333-4444-555555555555',
        clientId: '66666666-7777-8888-9999-000000000000',
      },
      'Use a client secret or certificate.',
    ],
    [
      'google-service-account',
      {
        authType: 'workload_identity',
        projectNumber: '123456789012',
        poolId: 'sim-pool',
        providerId: 'sim-provider',
        serviceAccountEmail: 'sim-workflows@my-project.iam.gserviceaccount.com',
      },
      'Use a JSON key.',
    ],
  ])(
    'refuses a keyless %s credential where this deployment cannot sign',
    async (providerId, configuration, remedy) => {
      await expect(
        verifyAndBuildServiceAccountSecret(providerId, {
          serviceAccountJson: JSON.stringify(configuration),
          owner: { workspaceId: 'ws-1', actorUserId: 'user-1' },
        })
      ).rejects.toMatchObject({
        code: 'validation',
        detailCode: 'WORKLOAD_IDENTITY_NOT_CONFIGURED',
        message: `Keyless connections are not available on this deployment. ${remedy}`,
      })
    }
  )

  it.each([
    [
      'aws-service-account',
      { authType: 'oidc_role', roleArn: 'arn:aws:iam::123456789012:role/SimWorkflows' },
      { type: 'aws_credential_v1' },
    ],
    [
      'databricks-service-account',
      {
        authType: 'oidc_federation',
        host: 'dbc-abc123.cloud.databricks.com',
        clientId: '11111111-2222-3333-4444-555555555555',
      },
      { type: 'databricks_credential_v1' },
    ],
  ])(
    'refuses reconnecting a keyless %s credential where this deployment cannot sign',
    async (providerId, configuration, secret) => {
      await expect(
        verifyAndBuildServiceAccountSecret(providerId, {
          serviceAccountJson: JSON.stringify(configuration),
          owner: {
            workspaceId: 'ws-1',
            actorUserId: 'user-1',
            storedSecret: {
              ...secret,
              config: {
                ...configuration,
                subject: 'sim:workspace:ws-1:credential:abcdef0123456789',
              },
            },
          },
        })
      ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_NOT_CONFIGURED' })
    }
  )

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

describe('a token provider in client-credentials mode', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
  })

  function answerShopify() {
    fetchMock.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'minted-token', expires_in: 86399 })
      }
      expect(request.headers.get('x-shopify-access-token')).toBe('minted-token')
      return Response.json({
        data: { shop: { name: 'Acme', myshopifyDomain: 'acme.myshopify.com' } },
      })
    })
  }

  it('stores the client credentials, never a token, after proving the minted token', async () => {
    answerShopify()

    const result = await verifyAndBuildServiceAccountSecret('shopify-service-account', {
      authMethod: 'client_credentials',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      domain: 'Acme.myshopify.com',
    })

    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      type: 'token_service_account',
      providerId: 'shopify-service-account',
      authMethod: 'client_credentials',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      domain: 'acme.myshopify.com',
    })
    expect(blob.apiToken).toBeUndefined()
    expect(result.encryptedServiceAccountKey).not.toContain('minted-token')
    expect(result.principal).toMatchObject({ kind: 'tenant', id: 'acme.myshopify.com' })
  })

  it('keeps a pasted Shopify token on the token path when no auth method is sent', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: { shop: { name: 'Acme', myshopifyDomain: 'acme.myshopify.com' } } })
    )

    const result = await verifyAndBuildServiceAccountSecret('shopify-service-account', {
      apiToken: ' shpat_pasted\n',
      domain: 'acme.myshopify.com',
      clientId: 'ignored',
      clientSecret: 'ignored',
    })

    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob.apiToken).toBe('shpat_pasted')
    expect(blob.authMethod).toBeUndefined()
    expect(blob.clientSecret).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('requires the client ID, secret, and store domain without calling Shopify', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret('shopify-service-account', {
        authMethod: 'client_credentials',
        clientId: 'client-1',
        domain: 'acme.myshopify.com',
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    await expect(
      verifyAndBuildServiceAccountSecret('shopify-service-account', {
        authMethod: 'client_credentials',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the token path for a provider without a client-credentials mode', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret('hubspot-service-account', {
        authMethod: 'client_credentials',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      })
    ).rejects.toThrow('apiToken is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a ServiceNow login', () => {
  const secureFetch = inputValidationMockFns.mockSecureFetchWithPinnedIP

  beforeEach(() => {
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.7',
      originalHostname: 'acme.service-now.com',
    })
    secureFetch.mockReset().mockResolvedValue(
      new Response(JSON.stringify({ result: [{ sys_id: 'abc' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it('verifies and stores a password with surrounding spaces exactly as typed', async () => {
    const result = await verifyAndBuildServiceAccountSecret('servicenow-service-account', {
      apiToken: ' pass word ',
      providerWorkspaceId: 'integration.user',
      domain: 'acme.service-now.com',
    })

    expect(secureFetch).toHaveBeenCalledWith(
      expect.any(String),
      '203.0.113.7',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('integration.user: pass word ').toString('base64')}`,
        }),
      })
    )
    expect(JSON.parse(result.encryptedServiceAccountKey).apiToken).toBe(' pass word ')
  })

  it('refuses a blank password without calling ServiceNow', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret('servicenow-service-account', {
        apiToken: '   ',
        providerWorkspaceId: 'integration.user',
        domain: 'acme.service-now.com',
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    expect(secureFetch).not.toHaveBeenCalled()
  })
})

describe('a Splunk username and password', () => {
  const secureFetch = inputValidationMockFns.mockSecureFetchWithPinnedIP

  beforeEach(() => {
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.7',
      originalHostname: 'splunk.example.com',
    })
    secureFetch.mockReset().mockResolvedValue(
      new Response(JSON.stringify({ entry: [{ content: { username: 'svc-sim' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it('verifies and stores a password with surrounding spaces exactly as typed', async () => {
    const result = await verifyAndBuildServiceAccountSecret('splunk-service-account', {
      apiToken: ' pass word ',
      providerWorkspaceId: 'svc-sim',
      domain: 'splunk.example.com:8089',
    })

    expect(secureFetch).toHaveBeenCalledWith(
      expect.any(String),
      '203.0.113.7',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('svc-sim: pass word ').toString('base64')}`,
        }),
      })
    )
    expect(JSON.parse(result.encryptedServiceAccountKey).apiToken).toBe(' pass word ')
  })

  it('still sends a pasted token without its surrounding whitespace', async () => {
    await verifyAndBuildServiceAccountSecret('splunk-service-account', {
      apiToken: ' splunk-token\n',
      domain: 'splunk.example.com:8089',
    })

    expect(secureFetch).toHaveBeenCalledWith(
      expect.any(String),
      '203.0.113.7',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer splunk-token' }),
      })
    )
  })
})

describe('a token provider whose region or host defaults to the one it always used', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    fetchMock.mockReset().mockResolvedValue(Response.json({ accountId: 'acct-1' }))
    vi.stubGlobal('fetch', fetchMock)
  })

  const requestedUrl = () => new Request(fetchMock.mock.calls[0][0], fetchMock.mock.calls[0][1]).url

  it.each([
    [
      'launchdarkly-service-account',
      undefined,
      'https://app.launchdarkly.com/api/v2/caller-identity',
      'us',
    ],
    [
      'launchdarkly-service-account',
      'eu',
      'https://app.eu.launchdarkly.com/api/v2/caller-identity',
      'eu',
    ],
    [
      'launchdarkly-service-account',
      'Federal',
      'https://app.launchdarkly.us/api/v2/caller-identity',
      'federal',
    ],
    [
      'langsmith-service-account',
      undefined,
      'https://api.smith.langchain.com/api/v1/workspaces',
      'us',
    ],
    [
      'langsmith-service-account',
      'eu',
      'https://eu.api.smith.langchain.com/api/v1/workspaces',
      'eu',
    ],
    [
      'langsmith-service-account',
      'azure-us',
      'https://azure.api.smith.langchain.com/api/v1/workspaces',
      'azure-us',
    ],
    [
      'square-service-account',
      undefined,
      'https://connect.squareup.com/v2/locations',
      'production',
    ],
    [
      'square-service-account',
      'sandbox',
      'https://connect.squareupsandbox.com/v2/locations',
      'sandbox',
    ],
    ['sendgrid-service-account', undefined, 'https://api.sendgrid.com/v3/scopes', 'global'],
    ['sendgrid-service-account', 'eu', 'https://api.eu.sendgrid.com/v3/scopes', 'eu'],
    [
      'hex-service-account',
      undefined,
      'https://app.hex.tech/api/v1/projects?limit=1',
      'app.hex.tech',
    ],
    [
      'hex-service-account',
      'eu.hex.tech',
      'https://eu.hex.tech/api/v1/projects?limit=1',
      'eu.hex.tech',
    ],
    [
      'hex-service-account',
      'https://Acme.hex.tech/',
      'https://acme.hex.tech/api/v1/projects?limit=1',
      'acme.hex.tech',
    ],
    ['sentry-service-account', undefined, 'https://sentry.io/api/0/organizations/', 'us'],
    ['sentry-service-account', 'de', 'https://de.sentry.io/api/0/organizations/', 'de'],
  ])('%s with %s is checked at %s and stored as %s', async (providerId, domain, url, stored) => {
    const result = await verifyAndBuildServiceAccountSecret(providerId, {
      apiToken: 'token-1',
      ...(domain === undefined ? {} : { domain }),
    })

    expect(requestedUrl()).toBe(url)
    expect(JSON.parse(result.encryptedServiceAccountKey)).toMatchObject({
      apiToken: 'token-1',
      domain: stored,
    })
  })

  it.each([
    [undefined, 'https://amplitude.com/api/2/events/list', 'us'],
    ['eu', 'https://analytics.eu.amplitude.com/api/2/events/list', 'eu'],
  ])(
    'checks an Amplitude project with residency %s at %s and stores it as %s',
    async (domain, url, stored) => {
      const result = await verifyAndBuildServiceAccountSecret('amplitude-service-account', {
        apiToken: 'secret-1',
        providerWorkspaceId: 'api-key-1',
        ...(domain === undefined ? {} : { domain }),
      })

      expect(requestedUrl()).toBe(url)
      expect(JSON.parse(result.encryptedServiceAccountKey)).toMatchObject({ domain: stored })
    }
  )

  it.each([
    ['launchdarkly-service-account', 'LaunchDarkly'],
    ['langsmith-service-account', 'LangSmith'],
    ['square-service-account', 'Square'],
    ['sendgrid-service-account', 'SendGrid'],
    ['hex-service-account', 'Hex'],
    ['sentry-service-account', 'Sentry'],
  ])(
    'names a %s credential on its default host %s, as before the field existed',
    async (providerId, label) => {
      const result = await verifyAndBuildServiceAccountSecret(providerId, { apiToken: 'token-1' })

      expect(result.displayName).toBe(label)
    }
  )

  it.each([
    ['sentry-service-account', 'de', 'Sentry (de)'],
    ['hex-service-account', 'eu.hex.tech', 'Hex (eu.hex.tech)'],
  ])('names a %s credential in %s after it', async (providerId, domain, displayName) => {
    const result = await verifyAndBuildServiceAccountSecret(providerId, {
      apiToken: 'token-1',
      domain,
    })

    expect(result.displayName).toBe(displayName)
  })

  const hostNotFound = () =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })

  it.each([
    ['sendgrid-service-account', undefined],
    ['sendgrid-service-account', 'eu'],
    ['sentry-service-account', 'de'],
    ['launchdarkly-service-account', 'federal'],
    ['hex-service-account', undefined],
  ])(
    'reports a %s vendor host (%s) that does not resolve as the vendor being unavailable',
    async (providerId, domain) => {
      fetchMock.mockRejectedValue(hostNotFound())

      await expect(
        verifyAndBuildServiceAccountSecret(providerId, {
          apiToken: 'token-1',
          ...(domain === undefined ? {} : { domain }),
        })
      ).rejects.toMatchObject({ code: 'provider_unavailable' })
    }
  )

  it('reports a typed Hex host that does not resolve as a host not found', async () => {
    fetchMock.mockRejectedValue(hostNotFound())

    await expect(
      verifyAndBuildServiceAccountSecret('hex-service-account', {
        apiToken: 'token-1',
        domain: 'acme.hex.tech',
      })
    ).rejects.toMatchObject({ code: 'site_not_found' })
  })

  it.each([
    ['launchdarkly-service-account', 'app.launchdarkly.example.com'],
    ['langsmith-service-account', 'eu.api.smith.langchain.com.example.com'],
    ['square-service-account', 'connect.squareupsandbox.com'],
    ['sendgrid-service-account', 'api.eu.sendgrid.com'],
    ['hex-service-account', 'hex.tech.example.com'],
    ['hex-service-account', 'acme.hex.tech@example.com'],
    ['hex-service-account', 'a.b.hex.tech'],
    ['hex-service-account', 'status.hex.tech'],
    ['hex-service-account', 'learn.hex.tech'],
    ['sentry-service-account', 'de.sentry.io.example.com'],
  ])(
    'refuses %s with an unlisted region or host %s without sending the token',
    async (providerId, domain) => {
      await expect(
        verifyAndBuildServiceAccountSecret(providerId, { apiToken: 'token-1', domain })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
})

describe('a Railway token', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('saves a project token without the workspace ID only workspace tokens need', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: { projectToken: { projectId: 'p1', environmentId: 'e1' } } })
    )

    const result = await verifyAndBuildServiceAccountSecret('railway-service-account', {
      apiToken: 'project-token',
      domain: 'project',
    })

    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({ apiToken: 'project-token', domain: 'project' })
    expect(blob).not.toHaveProperty('providerWorkspaceId')
  })

  it('stores the workspace ID a workspace token was verified against', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: { workspace: { id: 'ws-1', name: 'Acme' } } })
    )

    const result = await verifyAndBuildServiceAccountSecret('railway-service-account', {
      apiToken: 'workspace-token',
      domain: 'workspace',
      providerWorkspaceId: ' ws-1 ',
    })

    expect(JSON.parse(result.encryptedServiceAccountKey)).toMatchObject({
      domain: 'workspace',
      providerWorkspaceId: 'ws-1',
    })
  })
})

describe('an Infisical machine identity with Universal Auth', () => {
  const login = inputValidationMockFns.mockSecureFetchWithValidation
  const identityCheck = inputValidationMockFns.mockSecureFetchWithPinnedIP

  beforeEach(() => {
    storedCoordinatedTokens.clear()
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.9',
      originalHostname: 'secrets.example.com',
    })
    login
      .mockReset()
      .mockResolvedValue(
        Response.json({ accessToken: 'machine-token', expiresIn: 7200, tokenType: 'Bearer' })
      )
    identityCheck
      .mockReset()
      .mockResolvedValue(
        Response.json({ identityDetails: { organization: { id: 'org-1', name: 'Acme' } } })
      )
  })

  it('stores the client ID and secret, never a token, after proving the minted token', async () => {
    const result = await verifyAndBuildServiceAccountSecret('infisical-service-account', {
      authMethod: 'client_credentials',
      clientId: 'identity-client',
      clientSecret: 'identity-secret',
      domain: 'https://Secrets.Example.com/',
    })

    expect(login.mock.calls[0]?.[0]).toBe(
      'https://secrets.example.com/api/v1/auth/universal-auth/login'
    )
    expect(identityCheck).toHaveBeenCalledWith(
      'https://secrets.example.com/api/v1/identities/details',
      '203.0.113.9',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer machine-token' }),
      })
    )
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      type: 'token_service_account',
      providerId: 'infisical-service-account',
      authMethod: 'client_credentials',
      clientId: 'identity-client',
      clientSecret: 'identity-secret',
      domain: 'https://secrets.example.com',
    })
    expect(blob.apiToken).toBeUndefined()
    expect(result.encryptedServiceAccountKey).not.toContain('machine-token')
  })

  it('keeps a pasted access token on the token path when no auth method is sent', async () => {
    const result = await verifyAndBuildServiceAccountSecret('infisical-service-account', {
      apiToken: 'pasted-token',
      domain: 'https://secrets.example.com',
    })

    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob.apiToken).toBe('pasted-token')
    expect(blob.authMethod).toBeUndefined()
    expect(login).not.toHaveBeenCalled()
  })

  it('requires the instance URL without logging in', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret('infisical-service-account', {
        authMethod: 'client_credentials',
        clientId: 'identity-client',
        clientSecret: 'identity-secret',
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    expect(login).not.toHaveBeenCalled()
  })
})

describe('a ServiceNow OAuth client', () => {
  const tokenRequest = inputValidationMockFns.mockSecureFetchWithValidation
  const tableRead = inputValidationMockFns.mockSecureFetchWithPinnedIP

  beforeEach(() => {
    storedCoordinatedTokens.clear()
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.7',
      originalHostname: 'acme.service-now.com',
    })
    tokenRequest
      .mockReset()
      .mockResolvedValue(Response.json({ access_token: 'sn-minted', expires_in: 1799 }))
    tableRead.mockReset().mockResolvedValue(Response.json({ result: [{ sys_id: 'abc' }] }))
  })

  it('proves the minted token with a bearer table read and stores no username', async () => {
    const result = await verifyAndBuildServiceAccountSecret('servicenow-service-account', {
      authMethod: 'client_credentials',
      clientId: 'sn-client',
      clientSecret: 'sn-secret',
      domain: 'acme.service-now.com',
    })

    expect(tokenRequest.mock.calls[0]?.[0]).toBe('https://acme.service-now.com/oauth_token.do')
    expect(tableRead).toHaveBeenCalledWith(
      'https://acme.service-now.com/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id',
      '203.0.113.7',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sn-minted' }),
      })
    )
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      providerId: 'servicenow-service-account',
      authMethod: 'client_credentials',
      clientId: 'sn-client',
      clientSecret: 'sn-secret',
      domain: 'https://acme.service-now.com',
    })
    expect(blob.providerWorkspaceId).toBeUndefined()
    expect(blob.apiToken).toBeUndefined()
    expect(result.encryptedServiceAccountKey).not.toContain('sn-minted')
  })

  it('reports a rejected client as invalid credentials', async () => {
    tokenRequest.mockResolvedValue(
      Response.json({ error: 'access_denied', error_description: 'denied' }, { status: 401 })
    )

    await expect(
      verifyAndBuildServiceAccountSecret('servicenow-service-account', {
        authMethod: 'client_credentials',
        clientId: 'sn-client',
        clientSecret: 'sn-secret',
        domain: 'acme.service-now.com',
      })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(tableRead).not.toHaveBeenCalled()
  })
})

describe('a saved database connection', () => {
  const serviceAccountJson = JSON.stringify({
    host: 'db.example.com',
    port: 5432,
    database: 'app',
    username: 'app_user',
    password: 'secret',
  })

  it('asks the user to fix the connection when the database does not answer', async () => {
    mockPostgresqlQuery.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      verifyAndBuildServiceAccountSecret(POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID, {
        serviceAccountJson,
      })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
  })

  it('keeps an encryption failure on a verified connection a server error', async () => {
    mockPostgresqlQuery.mockResolvedValue({ rows: [{ sim_connection_ok: 1 }] })
    mockEncryptSecret.mockRejectedValue(new Error('KMS unavailable'))

    const saving = verifyAndBuildServiceAccountSecret(POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID, {
      serviceAccountJson,
    })

    await expect(saving).rejects.toThrow('KMS unavailable')
    await expect(saving).rejects.not.toBeInstanceOf(ServiceAccountSecretError)
  })
})
