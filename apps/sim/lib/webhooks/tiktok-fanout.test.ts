import { describe, expect, it } from 'vitest'
import { tiktokOpenIdFromAccountId } from '@/lib/webhooks/providers/tiktok'

describe('tiktokOpenIdFromAccountId', () => {
  it('strips the UUID suffix from OAuth accountId storage', () => {
    expect(
      tiktokOpenIdFromAccountId(
        'act.example12345Example12345Example-a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      )
    ).toBe('act.example12345Example12345Example')
  })

  it('leaves values without a UUID suffix unchanged', () => {
    expect(tiktokOpenIdFromAccountId('act.plain')).toBe('act.plain')
  })

  it('matches webhook user_openid to the stored prefix', () => {
    const userOpenId = 'act.example12345Example12345Example'
    const stored = `${userOpenId}-11111111-2222-3333-4444-555555555555`
    expect(tiktokOpenIdFromAccountId(stored)).toBe(userOpenId)
  })
})
