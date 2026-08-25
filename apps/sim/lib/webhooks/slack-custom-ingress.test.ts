/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getLegacySlackCustomBotCredentialId } from '@/lib/webhooks/slack-custom-ingress'

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    provider: 'slack',
    routingKey: 'credential-1',
    providerConfig: {
      triggerId: 'slack_webhook',
      credentialId: 'credential-1',
      ingressMode: 'legacy_custom_bot',
    },
    ...overrides,
  }
}

describe('getLegacySlackCustomBotCredentialId', () => {
  it('returns the credential for a fully marked legacy webhook', () => {
    expect(getLegacySlackCustomBotCredentialId(webhook())).toBe('credential-1')
  })

  it('ignores ordinary path webhooks', () => {
    expect(
      getLegacySlackCustomBotCredentialId(
        webhook({ providerConfig: { triggerId: 'slack_webhook' }, routingKey: null })
      )
    ).toBeNull()
  })

  it('fails fast on a partial marker', () => {
    expect(() =>
      getLegacySlackCustomBotCredentialId(webhook({ routingKey: 'credential-2' }))
    ).toThrow(/routing key does not match/)
  })
})
