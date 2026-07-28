/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractSlackTeamId } from '@/lib/oauth/slack'

describe('extractSlackTeamId', () => {
  it('extracts the team id from a scoped account id', () => {
    expect(
      extractSlackTeamId('T08CM6ZNYBE-usr_U08USBQ9B1T-cbf46a7e-ca75-4a2e-bef5-fd467299eaae')
    ).toBe('T08CM6ZNYBE')
  })

  it('extracts the team id from a legacy bot-segment account id', () => {
    expect(extractSlackTeamId('T08CM6ZNYBE-U08USBQ9B1T-599a2a79-2543-42fd-9a74-9e2c466a8b19')).toBe(
      'T08CM6ZNYBE'
    )
  })

  it('accepts enterprise grid ids', () => {
    expect(extractSlackTeamId('E0123ABCD-usr_U1-aaaa')).toBe('E0123ABCD')
  })

  it('returns null for pasted custom-bot account ids', () => {
    expect(extractSlackTeamId('slack-bot-1764756583292')).toBeNull()
  })

  it('returns null for lowercase or malformed ids', () => {
    expect(extractSlackTeamId('t123-usr_U1-x')).toBeNull()
    expect(extractSlackTeamId('T08CM6ZNYBE')).toBeNull()
    expect(extractSlackTeamId('')).toBeNull()
    expect(extractSlackTeamId(null)).toBeNull()
    expect(extractSlackTeamId(undefined)).toBeNull()
  })
})
