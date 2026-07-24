/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient, mockSet, mockGet, mockDel } = vi.hoisted(() => ({
  mockGetRedisClient: vi.fn(),
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  mockDel: vi.fn(),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import { createApproval, pollApproval } from '@/lib/cli-auth/approval-store'

const REQUEST = 'a'.repeat(43)
const SECRET = 'b'.repeat(43)
const CHALLENGE = createHash('sha256').update(SECRET).digest('base64url')

describe('cli-auth approval store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue({ set: mockSet, get: mockGet, del: mockDel })
  })

  describe('createApproval', () => {
    it('keys by the request-id digest, never the raw id', async () => {
      await createApproval('user-1', REQUEST, CHALLENGE)
      const [key] = mockSet.mock.calls[0]
      expect(key).toBe(`cli:auth:req:${createHash('sha256').update(REQUEST).digest('hex')}`)
      expect(key).not.toContain(REQUEST)
    })

    it('stores the challenge and user but no credential, with a TTL', async () => {
      await createApproval('user-1', REQUEST, CHALLENGE)
      const [, value, px, ttl] = mockSet.mock.calls[0]
      expect(JSON.parse(value)).toEqual({
        challenge: CHALLENGE,
        userId: 'user-1',
        createdAt: expect.any(Number),
      })
      expect([px, ttl]).toEqual(['PX', 120_000])
    })
  })

  describe('pollApproval', () => {
    it('returns pending when no approval exists yet', async () => {
      mockGet.mockResolvedValue(null)
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({ status: 'pending' })
      expect(mockDel).not.toHaveBeenCalled()
    })

    it('returns the user for a matching secret and consumes the approval', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
      )
      mockDel.mockResolvedValue(1)
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({
        status: 'approved',
        userId: 'user-1',
      })
      expect(mockDel).toHaveBeenCalledTimes(1)
    })

    it('does NOT delete the approval when the secret is wrong', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
      )
      await expect(pollApproval(REQUEST, 'c'.repeat(43))).resolves.toEqual({ status: 'pending' })
      expect(mockDel).not.toHaveBeenCalled()
    })

    it('yields to a concurrent poll that already claimed it', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
      )
      mockDel.mockResolvedValue(0)
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({ status: 'pending' })
    })
  })

  describe('without Redis', () => {
    beforeEach(() => mockGetRedisClient.mockReturnValue(null))

    it('fails fast on write', async () => {
      await expect(createApproval('user-1', REQUEST, CHALLENGE)).rejects.toThrow('REDIS_URL')
    })

    it('fails fast on poll', async () => {
      await expect(pollApproval(REQUEST, SECRET)).rejects.toThrow('REDIS_URL')
    })
  })
})
