import { describe, expect, it } from 'vitest'
import { syntheticConnectorEmail } from '@/lib/auth/connector-email'

describe('syntheticConnectorEmail', () => {
  it('namespaces the address by provider and identity', () => {
    expect(syntheticConnectorEmail('attio', 'abc123')).toBe('attio-abc123@connectors.sim.invalid')
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
})
