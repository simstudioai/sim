/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEncryptSecret, mockFetchSlackTeamId, mockValidateAtlassian, mockNormalizeDomain } =
  vi.hoisted(() => ({
    // Identity encryption so tests can read back the JSON blob.
    mockEncryptSecret: vi.fn(async (value: string) => ({ encrypted: value })),
    mockFetchSlackTeamId: vi.fn(),
    mockValidateAtlassian: vi.fn(),
    mockNormalizeDomain: vi.fn((raw: string) => raw.trim().toLowerCase()),
  }))

vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: mockEncryptSecret }))
vi.mock('@/lib/webhooks/providers/slack', () => ({ fetchSlackTeamId: mockFetchSlackTeamId }))
vi.mock('@/lib/credentials/atlassian-service-account', () => ({
  validateAtlassianServiceAccount: mockValidateAtlassian,
  normalizeAtlassianDomain: mockNormalizeDomain,
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
    vi.clearAllMocks()
    mockEncryptSecret.mockImplementation(async (value: string) => ({ encrypted: value }))
    mockNormalizeDomain.mockImplementation((raw: string) => raw.trim().toLowerCase())
  })

  it('verifies a Slack bot token and encrypts the derived blob', async () => {
    mockFetchSlackTeamId.mockResolvedValue({ teamId: 'T1', userId: 'U_BOT', teamName: 'Acme' })
    const result = await verifyAndBuildServiceAccountSecret(SLACK_CUSTOM_BOT_PROVIDER_ID, {
      signingSecret: 'sec',
      botToken: 'xoxb-1',
    })
    expect(result.providerId).toBe(SLACK_CUSTOM_BOT_PROVIDER_ID)
    expect(result.displayName).toBe('Acme')
    expect(result.auditMetadata.slackTeamId).toBe('T1')
    expect(result.botUserId).toBe('U_BOT')
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      signingSecret: 'sec',
      botToken: 'xoxb-1',
      teamId: 'T1',
      botUserId: 'U_BOT',
      teamName: 'Acme',
    })
  })

  it('throws when Slack required fields are missing', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret(SLACK_CUSTOM_BOT_PROVIDER_ID, { signingSecret: 'sec' })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
  })

  it('wraps a failed Slack token verification as a ServiceAccountSecretError', async () => {
    mockFetchSlackTeamId.mockRejectedValue(new Error('invalid_auth'))
    await expect(
      verifyAndBuildServiceAccountSecret(SLACK_CUSTOM_BOT_PROVIDER_ID, {
        signingSecret: 'sec',
        botToken: 'xoxb-bad',
      })
    ).rejects.toThrow(/Could not verify the Slack bot token/)
  })

  it('verifies an Atlassian token and encrypts the blob', async () => {
    mockValidateAtlassian.mockResolvedValue({
      accountId: 'acc-1',
      displayName: 'Jira Bot',
      cloudId: 'cloud-1',
    })
    const result = await verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, {
      apiToken: 'tok',
      domain: 'Acme.atlassian.net',
    })
    expect(result.providerId).toBe(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID)
    expect(result.displayName).toBe('Jira Bot')
    expect(result.auditMetadata.atlassianCloudId).toBe('cloud-1')
    const blob = JSON.parse(result.encryptedServiceAccountKey)
    expect(blob).toMatchObject({
      apiToken: 'tok',
      domain: 'acme.atlassian.net',
      cloudId: 'cloud-1',
    })
  })

  it('throws when Atlassian required fields are missing', async () => {
    await expect(
      verifyAndBuildServiceAccountSecret(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, { apiToken: 'tok' })
    ).rejects.toBeInstanceOf(ServiceAccountSecretError)
  })

  it('validates and encrypts a Google service-account JSON key', async () => {
    const json = JSON.stringify({ type: 'service_account', client_email: 'svc@proj.iam' })
    const result = await verifyAndBuildServiceAccountSecret('google-service-account', {
      serviceAccountJson: json,
    })
    expect(result.providerId).toBe('google-service-account')
    expect(result.displayName).toBe('svc@proj.iam')
    expect(result.encryptedServiceAccountKey).toBe(json)
  })

  it('accepts a legacy Google create with an empty providerId', async () => {
    const json = JSON.stringify({ type: 'service_account', client_email: 'svc@proj.iam' })
    const result = await verifyAndBuildServiceAccountSecret('', { serviceAccountJson: json })
    expect(result.providerId).toBe('google-service-account')
  })

  it('rejects an unknown non-empty providerId instead of persisting it as Google', async () => {
    const json = JSON.stringify({ type: 'service_account', client_email: 'svc@proj.iam' })
    await expect(
      verifyAndBuildServiceAccountSecret('hubspot-service-acount-typo', {
        serviceAccountJson: json,
      })
    ).rejects.toThrow('Unsupported service-account provider')
  })

  it('rejects prototype-chain providerIds with a validation error, not a TypeError', async () => {
    for (const providerId of ['__proto__', 'constructor', 'toString']) {
      await expect(
        verifyAndBuildServiceAccountSecret(providerId, { serviceAccountJson: '{}' })
      ).rejects.toThrow('Unsupported service-account provider')
    }
  })
})
