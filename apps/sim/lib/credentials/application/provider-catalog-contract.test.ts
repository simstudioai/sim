import { generateKeyPairSync } from 'node:crypto'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { blockVisibilityMock } from '@sim/testing/mocks/block-visibility.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  allowedIntegrationTypes: vi.fn(),
}))

vi.mock('@/lib/core/config/block-visibility', () => blockVisibilityMock)
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/integrations/principal-scope.server', () => ({
  principalUserId: () => 'user-1',
  allowedIntegrationTypes: hoisted.allowedIntegrationTypes,
  allowedOrganizationIntegrationTypes: hoisted.allowedIntegrationTypes,
}))

import { v2ListCredentialProvidersContract } from '@/lib/api/contracts/v2/credentials'
import { env } from '@/lib/core/config/env'
import { listCredentialProviders } from '@/lib/credentials/application/list-credential-providers'
import { listCredentialProviderCatalog } from '@/lib/credentials/application/provider-catalog'
import { DATABASE_CONNECTION_DESCRIPTORS } from '@/lib/credentials/database-connections/descriptors'
import { getMissingServiceAccountFields } from '@/lib/credentials/service-account-fields'
import {
  isWorkloadIdentityServiceAccountProviderId,
  WORKLOAD_IDENTITY_KEYLESS_CONFIGS,
  workloadIdentityProviderFor,
} from '@/lib/credentials/workload-identity/audiences'

const CLAUDE_PROVIDER_ID = 'claude-platform-service-account'
const GITHUB_INSTALLATION_PROVIDER_ID = 'github-app-installation'
const context = { workspaceId: 'workspace-1', workspaceOrganizationId: null }
const responseSchema = v2ListCredentialProvidersContract.response.schema
const SIGNING_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
})

async function listProviders(search?: string) {
  const { providers } = await listCredentialProviders.execute({
    principal: createSessionPrincipal(),
    input: { workspaceId: 'workspace-1', ...(search ? { search } : {}) },
  })
  return providers
}

describe('v2 credential provider catalog contract', () => {
  afterEach(() => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
    Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', undefined)
  })

  beforeEach(() => {
    hoisted.allowedIntegrationTypes.mockResolvedValue(null)
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      ...context,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
  })

  it('presents the full unfiltered catalog as a valid response', async () => {
    const providers = await listProviders()

    const parsed = responseSchema.safeParse({ data: providers, nextCursor: null })
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    expect(
      providers.some(
        (provider) =>
          provider.type === 'service_account' &&
          provider.providerId === GITHUB_INSTALLATION_PROVIDER_ID
      )
    ).toBe(false)
  })

  it('tells API callers the region an optional region field takes when omitted', async () => {
    const providers = await listProviders()
    const sentry = providers.find(
      (provider) =>
        provider.type === 'service_account' && provider.providerId === 'sentry-service-account'
    )

    expect(sentry?.fields.find((field) => field.id === 'domain')).toMatchObject({
      required: false,
      defaultValue: 'us',
      options: [
        { value: 'us', label: 'US (sentry.io)' },
        { value: 'de', label: 'EU (de.sentry.io)' },
      ],
    })
    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
  })

  it('keeps the field-less GitHub installation in the internal catalog for existing credentials', async () => {
    const catalog = await listCredentialProviderCatalog(createSessionPrincipal(), context)
    const installation = catalog.find(
      (provider) =>
        provider.type === 'service_account' &&
        provider.providerId === GITHUB_INSTALLATION_PROVIDER_ID
    )

    expect(installation?.fields).toEqual([])
    expect(responseSchema.safeParse({ data: catalog, nextCursor: null }).success).toBe(false)
  })

  it('advertises a keyless mode the API accepts, on exactly the keyless providers', async () => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', SIGNING_KEY)
    Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
    const providers = await listProviders()
    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
    const keyless = providers.flatMap((provider) =>
      provider.type === 'service_account' && provider.keyless ? [provider] : []
    )

    expect(keyless.length).toBeGreaterThan(0)
    for (const provider of keyless) {
      if (!isWorkloadIdentityServiceAccountProviderId(provider.providerId)) {
        throw new Error(
          `${provider.providerId} advertises keyless without a workload identity provider`
        )
      }
      expect(provider.keyless).toEqual({
        authType:
          WORKLOAD_IDENTITY_KEYLESS_CONFIGS[workloadIdentityProviderFor(provider.providerId)]
            .authType,
        requiredConfigFields: expect.any(Array),
        optionalConfigFields: expect.any(Array),
      })
      expect(provider.fields.map((field) => field.id)).toContain('serviceAccountJson')
      expect(
        getMissingServiceAccountFields(provider.providerId, { serviceAccountJson: '{}' })
      ).toEqual([])
    }
    const google = keyless.find((provider) => provider.providerId === 'google-service-account')
    expect(google?.description).toContain(WORKLOAD_IDENTITY_KEYLESS_CONFIGS.google.scope)
    expect(google?.fields.find((field) => field.id === 'serviceAccountJson')?.hint).toContain(
      WORKLOAD_IDENTITY_KEYLESS_CONFIGS.google.scope
    )
    const snowflake = keyless.find(
      (provider) => provider.providerId === 'snowflake-service-account'
    )
    const snowflakeConfiguration = snowflake?.fields.find(
      (field) => field.id === 'serviceAccountJson'
    )
    expect(snowflakeConfiguration).toMatchObject({ required: false, secret: true })
    expect(snowflakeConfiguration?.hint).toContain('"key_pair"')
    expect(snowflakeConfiguration?.hint).toContain('Keyless')
  })

  it('offers no keyless mode where this deployment cannot sign', async () => {
    const providers = await listProviders()
    const keylessProviders = providers.filter(
      (provider) =>
        provider.type === 'service_account' &&
        (provider.providerId === 'aws-service-account' ||
          provider.providerId === 'snowflake-service-account' ||
          provider.providerId === 'google-service-account')
    )

    for (const provider of keylessProviders) {
      if (provider.type !== 'service_account') continue
      expect(provider.keyless).toBeUndefined()
    }
    const snowflake = keylessProviders.find(
      (provider) =>
        provider.type === 'service_account' && provider.providerId === 'snowflake-service-account'
    )
    expect(snowflake?.fields.map((field) => field.id)).toEqual([
      'domain',
      'apiToken',
      'serviceAccountJson',
    ])
    const configuration = snowflake?.fields.find((field) => field.id === 'serviceAccountJson')
    expect(configuration).toMatchObject({ required: false, secret: true, multiline: true })
    expect(configuration?.hint).toContain('"key_pair"')
    expect(configuration?.hint).not.toContain('Keyless')
  })

  it('offers the Snowflake key pair to organization credentials, which have no keyless mode', async () => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', SIGNING_KEY)
    Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
    const catalog = await listCredentialProviderCatalog(createSessionPrincipal(), {
      organizationId: 'org-1',
    })
    const snowflake = catalog.find(
      (provider) =>
        provider.type === 'service_account' && provider.providerId === 'snowflake-service-account'
    )

    expect(snowflake?.type === 'service_account' && snowflake.keyless).toBeFalsy()
    const configuration = snowflake?.fields.find((field) => field.id === 'serviceAccountJson')
    expect(configuration?.hint).toContain('"key_pair"')
    expect(configuration?.hint).not.toContain('Keyless')
  })

  it('tells headless clients the ServiceNow username belongs to the password sign-in only', async () => {
    const providers = await listProviders('servicenow')
    const servicenow = providers.find(
      (provider) =>
        provider.type === 'service_account' && provider.providerId === 'servicenow-service-account'
    )

    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
    expect(servicenow?.fields.find((field) => field.id === 'providerWorkspaceId')).toMatchObject({
      required: true,
      requiredForAuthMethods: ['token'],
    })
    expect(
      servicenow?.fields.find((field) => field.id === 'domain')?.requiredForAuthMethods
    ).toBeUndefined()
  })

  it('lists the native Claude Platform provider when filtered', async () => {
    const providers = await listProviders('claude')

    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
    expect(providers).toContainEqual(
      expect.objectContaining({
        type: 'service_account',
        serviceId: CLAUDE_PROVIDER_ID,
        providerId: CLAUDE_PROVIDER_ID,
        available: true,
        requiresClientGeneratedCredentialId: false,
        fields: [expect.objectContaining({ id: 'apiToken', required: true, secret: true })],
      })
    )
  })

  it('reports Claude as unavailable, not missing, when integration policy disables it', async () => {
    hoisted.allowedIntegrationTypes.mockResolvedValue(new Set(['slack']))

    const providers = await listProviders()

    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
    expect(providers).toContainEqual(
      expect.objectContaining({ providerId: CLAUDE_PROVIDER_ID, available: false })
    )
  })

  it('tells API callers what each saved database connection transport-security mode trades away', async () => {
    const providers = await listProviders()

    for (const descriptor of Object.values(DATABASE_CONNECTION_DESCRIPTORS)) {
      const provider = providers.find(
        (entry) => entry.type === 'service_account' && entry.providerId === descriptor.providerId
      )
      const hint = provider?.fields.find((field) => field.id === 'serviceAccountJson')?.hint
      for (const field of descriptor.tls) {
        expect(hint).toContain(field.hint)
      }
    }
  })
})
