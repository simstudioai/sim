import { describe, expect, it } from 'vitest'
import {
  instagramAuthorizeQuerySchema,
  instagramCallbackQuerySchema,
  trelloAuthorizeQuerySchema,
} from '@/lib/api/contracts/oauth-connections'

describe('Instagram OAuth query contracts', () => {
  it('rejects oversized return URLs before they can be persisted in a cookie', () => {
    expect(
      instagramAuthorizeQuerySchema.safeParse({
        returnUrl: `https://sim.ai/${'a'.repeat(2048)}`,
      }).success
    ).toBe(false)
  })

  it('rejects oversized callback fields', () => {
    expect(instagramCallbackQuerySchema.safeParse({ code: 'a'.repeat(8193) }).success).toBe(false)
    expect(instagramCallbackQuerySchema.safeParse({ state: 'a'.repeat(257) }).success).toBe(false)
    expect(
      instagramCallbackQuerySchema.safeParse({ error_description: 'a'.repeat(2049) }).success
    ).toBe(false)
  })
})

describe('Trello OAuth query contracts', () => {
  it('rejects an oversized return URL before it can be persisted in a cookie', () => {
    expect(
      trelloAuthorizeQuerySchema.safeParse({
        returnUrl: `https://sim.ai/${'a'.repeat(2048)}`,
      }).success
    ).toBe(false)
  })
})
