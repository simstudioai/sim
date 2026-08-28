/**
 * @vitest-environment node
 *
 * Covers the single write path the non-Better-Auth connect flows (Shopify, Instagram,
 * Trello) share. These three previously carried a copy each of find/update/insert/re-find,
 * and all three had to be edited in lockstep to add encryption — which is the drift this
 * helper exists to prevent, so its contract is pinned here.
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock, setEnv } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { upsertProviderAccountTokens } from '@/lib/oauth/credential-service'

const IDENTITY = { userId: 'user-1', providerId: 'shopify', externalAccountId: 'store-1' }

/** A single argument object that is a valid call for every provider. */
function callArgs(overrides: Record<string, unknown> = {}) {
  return {
    ...IDENTITY,
    scope: 'read_orders',
    tokens: { accessToken: 'plaintext-token' },
    ...overrides,
  }
}

function lastSetPayload(): Record<string, unknown> {
  const calls = dbChainMockFns.set.mock.calls
  return calls[calls.length - 1]?.[0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnv({ ENCRYPTION_KEY: '0123456789abcdef'.repeat(4) })
  mockIsFeatureEnabled.mockResolvedValue(true)
})

describe('upsertProviderAccountTokens', () => {
  describe('when the account already exists', () => {
    beforeEach(() => {
      queueTableRows(schemaMock.account, [{ id: 'account-1' }])
    })

    it('updates in place and returns the existing id without inserting', async () => {
      await expect(upsertProviderAccountTokens(callArgs())).resolves.toEqual({
        accountId: 'account-1',
      })

      expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.account)
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    it('stores the access token enveloped, never in plaintext', async () => {
      await upsertProviderAccountTokens(callArgs())

      const payload = lastSetPayload()
      expect(payload.accessToken).not.toBe('plaintext-token')
      expect(String(payload.accessToken).startsWith('simenc:v1:')).toBe(true)
    })

    it('writes plaintext when the flag is off, so the rollout is reversible', async () => {
      mockIsFeatureEnabled.mockResolvedValue(false)
      await upsertProviderAccountTokens(callArgs())

      expect(lastSetPayload().accessToken).toBe('plaintext-token')
    })

    it('envelopes every token the provider supplied', async () => {
      await upsertProviderAccountTokens(
        callArgs({
          providerId: 'instagram',
          /** Instagram's long-lived token is its own refresh token. */
          tokens: {
            accessToken: 'ig_token',
            refreshToken: 'ig_token',
            idToken: 'store.myshopify.com',
          },
        })
      )

      const payload = lastSetPayload()
      for (const field of ['accessToken', 'refreshToken', 'idToken']) {
        expect(String(payload[field]).startsWith('simenc:v1:')).toBe(true)
      }
      /** Separate IVs, so the two identical plaintexts must not collide. */
      expect(payload.accessToken).not.toBe(payload.refreshToken)
    })

    it('refreshes updatedAt, which the Slack and Instagram guards both read', async () => {
      await upsertProviderAccountTokens(callArgs())
      expect(lastSetPayload().updatedAt).toBeInstanceOf(Date)
    })

    it('omits accessTokenExpiresAt when the provider does not supply one', async () => {
      await upsertProviderAccountTokens(callArgs())
      expect('accessTokenExpiresAt' in lastSetPayload()).toBe(false)
    })

    it('sets accessTokenExpiresAt when the provider does supply one', async () => {
      const accessTokenExpiresAt = new Date('2026-09-01T00:00:00.000Z')
      await upsertProviderAccountTokens(callArgs({ accessTokenExpiresAt }))
      expect(lastSetPayload().accessTokenExpiresAt).toBe(accessTokenExpiresAt)
    })
  })

  describe('when the account does not exist', () => {
    it('inserts an enveloped row and returns the persisted id', async () => {
      queueTableRows(schemaMock.account, [])
      queueTableRows(schemaMock.account, [{ id: 'account-new' }])

      await expect(upsertProviderAccountTokens(callArgs())).resolves.toEqual({
        accountId: 'account-new',
      })

      expect(dbChainMockFns.insert).toHaveBeenCalledWith(schemaMock.account)
      const inserted = dbChainMockFns.values.mock.calls[0]?.[0] as Record<string, unknown>
      expect(String(inserted.accessToken).startsWith('simenc:v1:')).toBe(true)
      expect(inserted).toMatchObject({
        userId: 'user-1',
        providerId: 'shopify',
        accountId: 'store-1',
        scope: 'read_orders',
      })
    })

    /**
     * `safeAccountInsert` swallows a duplicate-key race, so a missing row on the re-read
     * means the write genuinely did not land — the caller must not get a bogus account id.
     */
    it('throws when the row is still absent after the insert', async () => {
      queueTableRows(schemaMock.account, [])
      queueTableRows(schemaMock.account, [])

      await expect(upsertProviderAccountTokens(callArgs())).rejects.toThrow(
        'shopify OAuth account store-1 was not persisted'
      )
    })
  })
})
