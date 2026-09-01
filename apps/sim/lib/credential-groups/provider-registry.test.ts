/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createAtlassianManagedOAuthConnector,
  createGoogleManagedOAuthConnector,
  getManagedOAuthConnectorPolicy,
} from '@/lib/auth/connectors/managed-oauth'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS,
  getCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderService,
  getCredentialGroupStandardOAuthProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'

const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'

describe('Credential Group provider registry', () => {
  it('derives provider identity and display metadata from the OAuth service catalog', () => {
    const service = getCredentialGroupProviderService('gmail')

    expect(service.name).toBe('Gmail')
    expect(service.providerId).toBe('google-email')
    expect(getCredentialGroupProviderFromProviderId(service.providerId)).toBe('gmail')
  })

  it('maps Google Calendar to its existing OAuth provider', () => {
    const service = getCredentialGroupProviderService('google-calendar')

    expect(service.name).toBe('Google Calendar')
    expect(service.providerId).toBe('google-calendar')
    expect(getCredentialGroupProviderFromProviderId(service.providerId)).toBe('google-calendar')
  })

  it.each(['confluence', 'jira'] as const)(
    'maps %s to its existing OAuth provider and adapter',
    (provider) => {
      const service = getCredentialGroupProviderService(provider)

      expect(service.providerId).toBe(provider)
      expect(getCredentialGroupProviderFromProviderId(service.providerId)).toBe(provider)
      expect(getCredentialGroupStandardOAuthProviderFromProviderId(service.providerId)).toBe(
        provider
      )
      expect(getCredentialGroupProviderAdapter(provider).provider).toBe(provider)
    }
  )

  it('uses provider-owned scope implication rules', () => {
    const managedOAuth = createGoogleManagedOAuthConnector('google-email')
    const canonicalScopes = getCredentialGroupProviderService('gmail').scopes
    const grantedScopes = canonicalScopes.filter(
      (scope) => scope !== GMAIL_SEND_SCOPE && scope !== GMAIL_LABELS_SCOPE
    )

    expect(grantedScopes).toContain(GMAIL_MODIFY_SCOPE)
    expect(managedOAuth.hasRequiredScopes(grantedScopes, canonicalScopes)).toBe(true)
    expect(managedOAuth.hasRequiredScopes([], canonicalScopes)).toBe(false)
  })

  it('requires the complete Google Calendar scope policy', () => {
    const managedOAuth = createGoogleManagedOAuthConnector('google-calendar')
    const requiredScopes = getCredentialGroupProviderService('google-calendar').scopes

    expect(managedOAuth.hasRequiredScopes(requiredScopes, requiredScopes)).toBe(true)
    expect(managedOAuth.hasRequiredScopes(requiredScopes.slice(1), requiredScopes)).toBe(false)
  })

  it.each(['confluence', 'jira'] as const)('requires the complete %s scope policy', (provider) => {
    const managedOAuth = createAtlassianManagedOAuthConnector(provider)
    const requiredScopes = getCredentialGroupProviderService(provider).scopes

    expect(managedOAuth.hasRequiredScopes(requiredScopes, requiredScopes)).toBe(true)
    expect(managedOAuth.hasRequiredScopes(requiredScopes.slice(1), requiredScopes)).toBe(false)
  })

  it('maps the legacy Slack tool scope bundle to the managed-user policy', () => {
    const adapter = getCredentialGroupProviderAdapter('slack')
    const canonicalScopes = getCredentialGroupProviderService('slack').scopes

    expect(adapter.hasRequiredScopes([...SLACK_MANAGED_USER_SCOPES], canonicalScopes)).toBe(true)
    expect(
      adapter.hasRequiredScopes(
        SLACK_MANAGED_USER_SCOPES.filter((scope) => scope !== 'chat:write'),
        canonicalScopes
      )
    ).toBe(false)
    expect(adapter.hasRequiredScopes(['chat:write'], ['chat:write'])).toBe(true)
  })

  it('fails fast for an unregistered managed provider ID', () => {
    expect(() => getCredentialGroupProviderFromProviderId('unknown-provider')).toThrow(
      'Unsupported managed credential provider'
    )
    expect(() => getCredentialGroupStandardOAuthProviderFromProviderId('slack')).toThrow(
      'Unsupported managed OAuth provider'
    )
  })
  it.each(CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS)(
    'backs %s with a managed OAuth policy and a round-trippable provider id',
    (provider) => {
      const service = getCredentialGroupProviderService(provider)

      expect(getCredentialGroupProviderFromProviderId(service.providerId)).toBe(provider)
      expect(getCredentialGroupStandardOAuthProviderFromProviderId(service.providerId)).toBe(
        provider
      )
      expect(getCredentialGroupProviderAdapter(provider).provider).toBe(provider)
      /**
       * The provider list and the connector policy catalog are maintained separately, so an entry
       * added to one and not the other would otherwise only surface as a runtime configuration
       * error the first time somebody tried to enroll.
       */
      expect(getManagedOAuthConnectorPolicy(service.providerId)).toBeDefined()
    }
  )

  it.each(CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS)(
    'gives %s either a scope policy or an explicit scopeless declaration',
    (provider) => {
      const service = getCredentialGroupProviderService(provider)
      const policy = getManagedOAuthConnectorPolicy(service.providerId)
      const requiredScopes = [...service.scopes, ...(policy?.additionalScopes ?? [])]

      expect(requiredScopes.length > 0 || policy?.scopeless === true).toBe(true)
    }
  )
})
