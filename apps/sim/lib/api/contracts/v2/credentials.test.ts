/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  V2_OAUTH_CONNECTION_PROVIDER_IDS,
  v2CreateCredentialConnectionBodySchema,
} from '@/lib/api/contracts/v2/credentials'
import { getAllOAuthServices } from '@/lib/oauth/utils'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const QUICKBOOKS_CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  environment: 'sandbox' as const,
  webhookVerifierToken: 'verifier-token',
}

interface CredentialConnectionJsonSchema {
  anyOf?: CredentialConnectionJsonSchema[]
  properties?: {
    credentialId?: { description?: string }
    oauthClientConfig?: {
      description?: string
      properties?: {
        clientSecret?: { writeOnly?: boolean }
        webhookVerifierToken?: { writeOnly?: boolean }
      }
    }
  }
}

describe('v2CreateCredentialConnectionBodySchema', () => {
  it('keeps the documented provider enum in sync with provider discovery', () => {
    const discoveredProviderIds = getAllOAuthServices()
      .filter((service) => service.authType === 'oauth')
      .flatMap((service) => [service.providerId, ...(service.additionalProviderIds ?? [])])

    expect(V2_OAUTH_CONNECTION_PROVIDER_IDS).toEqual(discoveredProviderIds)
  })

  it('requires app credentials for a new QuickBooks connection', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        providerId: 'quickbooks',
        displayName: 'Accounting',
      }).success
    ).toBe(false)
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        providerId: 'quickbooks',
        displayName: 'Accounting',
        oauthClientConfig: QUICKBOOKS_CONFIG,
      }).success
    ).toBe(true)
  })

  it('rejects QuickBooks-only app credentials for another provider', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        providerId: 'google-email',
        displayName: 'Mail',
        oauthClientConfig: QUICKBOOKS_CONFIG,
      }).success
    ).toBe(false)
  })

  it('allows reconnect configuration because the use case resolves its provider', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        credentialId: 'credential-1',
        oauthClientConfig: QUICKBOOKS_CONFIG,
      }).success
    ).toBe(true)
  })

  it('publishes QuickBooks reconnect requirements and secret fields accurately', () => {
    const published = z.toJSONSchema(v2CreateCredentialConnectionBodySchema, {
      io: 'input',
      unrepresentable: 'any',
    }) as CredentialConnectionJsonSchema
    const newQuickBooksConfig = published.anyOf?.[0]?.anyOf?.[0]?.properties?.oauthClientConfig
    const reconnect = published.anyOf?.[1]
    const reconnectConfig = reconnect?.properties?.oauthClientConfig

    expect(reconnect?.properties?.credentialId?.description).toContain(
      'QuickBooks reconnects also require oauthClientConfig'
    )
    expect(reconnectConfig?.description).toContain('Required when credentialId identifies')
    for (const config of [newQuickBooksConfig, reconnectConfig]) {
      expect(config?.properties?.clientSecret?.writeOnly).toBe(true)
      expect(config?.properties?.webhookVerifierToken?.writeOnly).toBe(true)
    }
  })
})
