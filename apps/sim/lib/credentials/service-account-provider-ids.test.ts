import { describe, expect, it } from 'vitest'
import { isServiceAccountProviderId } from '@/lib/credentials/service-account-provider-ids'

describe('isServiceAccountProviderId', () => {
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
