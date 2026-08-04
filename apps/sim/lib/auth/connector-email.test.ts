/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { syntheticConnectorEmail } from '@/lib/auth/connector-email'

describe('syntheticConnectorEmail', () => {
  it('namespaces the address by provider and identity', () => {
    expect(syntheticConnectorEmail('attio', 'abc123')).toBe('attio-abc123@connectors.sim.invalid')
  })

  it('always lands on the RFC 2606 reserved .invalid TLD', () => {
    const providers: Array<[string, string]> = [
      ['x', 'someuser'],
      ['hubspot', '12345'],
      ['salesforce', '005xx'],
      ['docusign', 'sub-1'],
      ['calcom', '77'],
      ['atlassian', 'acct'],
      ['wordpress', 'blogger'],
    ]
    for (const [provider, id] of providers) {
      const email = syntheticConnectorEmail(provider, id)
      expect(email.endsWith('@connectors.sim.invalid')).toBe(true)
    }
  })

  it('never emits a live third-party domain', () => {
    const email = syntheticConnectorEmail('x', 'jack')
    expect(email).not.toMatch(/@(x|hubspot|docusign|cal|salesforce|atlassian|wordpress)\.com$/)
  })

  it('distinguishes the same external id across providers', () => {
    expect(syntheticConnectorEmail('zoom', '42')).not.toBe(syntheticConnectorEmail('spotify', '42'))
  })

  it('is deterministic for the same input', () => {
    expect(syntheticConnectorEmail('monday', 99)).toBe(syntheticConnectorEmail('monday', 99))
  })

  it('accepts numeric identifiers', () => {
    expect(syntheticConnectorEmail('monday', 99)).toBe('monday-99@connectors.sim.invalid')
  })

  it('strips characters that are illegal in an unquoted local part', () => {
    expect(syntheticConnectorEmail('slack', 'T123-usr_U456')).toBe(
      'slack-T123-usr_U456@connectors.sim.invalid'
    )
    expect(syntheticConnectorEmail('reddit', 'some user!@#')).toBe(
      'reddit-someuser@connectors.sim.invalid'
    )
  })

  it('keeps the local part inside the RFC 5321 64-character limit', () => {
    const email = syntheticConnectorEmail('a'.repeat(100), 'b'.repeat(100))
    const [localPart] = email.split('@')
    expect(localPart.length).toBeLessThanOrEqual(64)
  })

  it('does not leave a dot or hyphen at either edge of a truncated segment', () => {
    const email = syntheticConnectorEmail('wealthbox', `${'c'.repeat(29)}...tail`)
    const [localPart] = email.split('@')
    expect(localPart.endsWith('.')).toBe(false)
    expect(localPart.startsWith('.')).toBe(false)
  })

  it('falls back to placeholders rather than emitting an empty local part', () => {
    expect(syntheticConnectorEmail('notion', undefined)).toBe(
      'notion-unknown@connectors.sim.invalid'
    )
    expect(syntheticConnectorEmail('notion', '')).toBe('notion-unknown@connectors.sim.invalid')
    expect(syntheticConnectorEmail('', '')).toBe('connector-unknown@connectors.sim.invalid')
    expect(syntheticConnectorEmail('!!!', '###')).toBe('connector-unknown@connectors.sim.invalid')
  })

  it('always returns a truthy value, which is what Better Auth 1.6.23 requires', () => {
    expect(syntheticConnectorEmail('', undefined)).toBeTruthy()
  })
})
