/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getServiceAccountConnectNoun,
  getServiceAccountGatingBlockType,
  isServiceAccountProviderId,
} from '@/lib/credentials/service-account-provider-ids'

describe('isServiceAccountProviderId', () => {
  it('recognizes every family of service-account id', () => {
    expect(isServiceAccountProviderId('google-service-account')).toBe(true)
    expect(isServiceAccountProviderId('atlassian-service-account')).toBe(true)
    expect(isServiceAccountProviderId('slack-custom-bot')).toBe(true)
    expect(isServiceAccountProviderId('notion-service-account')).toBe(true)
    expect(isServiceAccountProviderId('salesforce-service-account')).toBe(true)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(isServiceAccountProviderId('  SLACK-CUSTOM-BOT ')).toBe(true)
  })

  it('rejects OAuth provider values and unknowns', () => {
    // The distinction the oauth_get_auth_link guard depends on: `slack` is an
    // OAuth provider value, not a service-account id, even though Slack offers a
    // custom bot.
    expect(isServiceAccountProviderId('slack')).toBe(false)
    expect(isServiceAccountProviderId('google-email')).toBe(false)
    expect(isServiceAccountProviderId('github')).toBe(false)
    expect(isServiceAccountProviderId('')).toBe(false)
  })
})

describe('getServiceAccountGatingBlockType', () => {
  it('maps the custom Slack bot to slack_v2 and leaves everything else ungated', () => {
    expect(getServiceAccountGatingBlockType('slack-custom-bot')).toBe('slack_v2')
    expect(getServiceAccountGatingBlockType('notion-service-account')).toBeNull()
    expect(getServiceAccountGatingBlockType('google-service-account')).toBeNull()
    expect(getServiceAccountGatingBlockType('salesforce-service-account')).toBeNull()
  })
})

describe('getServiceAccountConnectNoun', () => {
  it('names the token-paste secret each provider actually collects', () => {
    expect(getServiceAccountConnectNoun('notion-service-account')).toBe('integration secret')
    expect(getServiceAccountConnectNoun('hubspot-service-account')).toBe('private app token')
    expect(getServiceAccountConnectNoun('linear-service-account')).toBe('API key')
  })

  it('names the client-credential secret', () => {
    expect(getServiceAccountConnectNoun('zoom-service-account')).toBe('server-to-server app')
  })

  it('calls a custom Slack bot a custom bot', () => {
    expect(getServiceAccountConnectNoun('slack-custom-bot')).toBe('custom bot')
  })

  it('falls back to the generic noun for bespoke providers with no descriptor', () => {
    // Google (paste a JSON key) and Atlassian (token + domain) have no
    // token/client descriptor, so they read as a plain "service account".
    expect(getServiceAccountConnectNoun('google-service-account')).toBe('service account')
    expect(getServiceAccountConnectNoun('atlassian-service-account')).toBe('service account')
  })
})
