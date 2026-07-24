/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient, mockSet, mockGetdel } = vi.hoisted(() => ({
  mockGetRedisClient: vi.fn(),
  mockSet: vi.fn(),
  mockGetdel: vi.fn(),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import { consumeAuthCode, createAuthCode } from '@/lib/cli-auth/code-store'

const VERIFIER = 'a'.repeat(43)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

describe('cli-auth code store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue({ set: mockSet, getdel: mockGetdel })
  })

  describe('createAuthCode', () => {
    it('stores only the code digest, never the plaintext', async () => {
      const code = await createAuthCode('user-1', CHALLENGE)

      const [key, value] = mockSet.mock.calls[0]
      expect(key).toBe(`cli:auth:code:${createHash('sha256').update(code).digest('hex')}`)
      expect(key).not.toContain(code)
      expect(value).not.toContain(code)
    })

    it('stores no credential in the record', async () => {
      await createAuthCode('user-1', CHALLENGE)

      const record = JSON.parse(mockSet.mock.calls[0][1])
      expect(record).toEqual({
        challenge: CHALLENGE,
        userId: 'user-1',
        createdAt: expect.any(Number),
      })
    })

    it('expires the code after two minutes', async () => {
      await createAuthCode('user-1', CHALLENGE)
      expect(mockSet.mock.calls[0].slice(2)).toEqual(['PX', 120_000])
    })

    it('issues a distinct code each time', async () => {
      const first = await createAuthCode('user-1', CHALLENGE)
      const second = await createAuthCode('user-1', CHALLENGE)
      expect(first).not.toBe(second)
    })
  })

  describe('consumeAuthCode', () => {
    it('returns the approving user for a matching verifier', async () => {
      mockGetdel.mockResolvedValue(
        JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
      )

      await expect(consumeAuthCode('some-code', VERIFIER)).resolves.toBe('user-1')
    })

    it('deletes the code before verifying, so a wrong verifier still burns it', async () => {
      mockGetdel.mockResolvedValue(
        JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
      )

      await expect(consumeAuthCode('some-code', 'b'.repeat(43))).resolves.toBeNull()
      expect(mockGetdel).toHaveBeenCalledTimes(1)
    })

    it('returns null for an unknown or expired code', async () => {
      mockGetdel.mockResolvedValue(null)
      await expect(consumeAuthCode('missing', VERIFIER)).resolves.toBeNull()
    })

    it('cannot be redeemed twice', async () => {
      mockGetdel
        .mockResolvedValueOnce(
          JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
        )
        .mockResolvedValueOnce(null)

      await expect(consumeAuthCode('some-code', VERIFIER)).resolves.toBe('user-1')
      await expect(consumeAuthCode('some-code', VERIFIER)).resolves.toBeNull()
    })
  })

  describe('without Redis', () => {
    beforeEach(() => {
      mockGetRedisClient.mockReturnValue(null)
    })

    it('fails fast on write', async () => {
      await expect(createAuthCode('user-1', CHALLENGE)).rejects.toThrow('REDIS_URL')
    })

    it('fails fast on read', async () => {
      await expect(consumeAuthCode('some-code', VERIFIER)).rejects.toThrow('REDIS_URL')
    })
  })
})
