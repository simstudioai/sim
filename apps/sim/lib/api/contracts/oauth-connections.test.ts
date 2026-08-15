/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  connectedAccountsQuerySchema,
  instagramAuthorizeQuerySchema,
  instagramCallbackQuerySchema,
  trelloAuthorizeQuerySchema,
} from '@/lib/api/contracts/oauth-connections'

describe('Connected account query contracts', () => {
  it('preserves first-value and blank-provider normalization', () => {
    expect(connectedAccountsQuerySchema.parse({ provider: '' })).toEqual({
      provider: undefined,
    })
    expect(connectedAccountsQuerySchema.parse({ provider: ['google', 'slack'] })).toEqual({
      provider: 'google',
    })
  })
})

describe('Instagram OAuth query contracts', () => {
  it('accepts bounded authorize and callback values', () => {
    expect(
      instagramAuthorizeQuerySchema.safeParse({
        returnUrl: 'https://sim.ai/workspace/example',
        workspaceId: 'workspace-1',
      }).success
    ).toBe(true)
    expect(
      instagramCallbackQuerySchema.safeParse({
        code: 'authorization-code',
        state: 'oauth-state',
      }).success
    ).toBe(true)
  })

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
  it('accepts a bounded chat return URL', () => {
    expect(
      trelloAuthorizeQuerySchema.safeParse({
        returnUrl: 'https://sim.ai/workspace/workspace-1/chat/chat-1?oauthAttempt=attempt-1',
      }).success
    ).toBe(true)
  })

  it('rejects an oversized return URL before it can be persisted in a cookie', () => {
    expect(
      trelloAuthorizeQuerySchema.safeParse({
        returnUrl: `https://sim.ai/${'a'.repeat(2048)}`,
      }).success
    ).toBe(false)
  })
})
