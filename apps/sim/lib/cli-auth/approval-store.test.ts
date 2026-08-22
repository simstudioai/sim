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

import {
  completeApproval,
  createApproval,
  pollApproval,
  releaseMint,
} from '@/lib/cli-auth/approval-store'

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
        scope: 'copilot',
        createdAt: expect.any(Number),
      })
      expect([px, ttl]).toEqual(['PX', 120_000])
    })

    it('records the consented scope and workspace', async () => {
      await createApproval('user-1', REQUEST, CHALLENGE, {
        scope: 'platform',
        workspaceId: 'ws-1',
        workspaceBound: true,
      })
      expect(JSON.parse(mockSet.mock.calls[0][1])).toMatchObject({
        scope: 'platform',
        workspaceId: 'ws-1',
        workspaceBound: true,
      })
    })

    it('omits the workspace fields entirely when no workspace was picked', async () => {
      await createApproval('user-1', REQUEST, CHALLENGE, { scope: 'platform' })
      const record = JSON.parse(mockSet.mock.calls[0][1])
      expect(record).not.toHaveProperty('workspaceId')
      expect(record).not.toHaveProperty('workspaceBound')
    })

    it('records a picked workspace as unbound unless binding was asked for', async () => {
      await createApproval('user-1', REQUEST, CHALLENGE, {
        scope: 'platform',
        workspaceId: 'ws-1',
      })
      expect(JSON.parse(mockSet.mock.calls[0][1])).toMatchObject({
        workspaceId: 'ws-1',
        workspaceBound: false,
      })
    })
  })

  describe('pollApproval', () => {
    const storedApproval = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        challenge: CHALLENGE,
        userId: 'user-1',
        scope: 'copilot',
        createdAt: Date.now(),
        ...overrides,
      })

    it('returns pending when no approval exists yet', async () => {
      mockGet.mockResolvedValue(null)
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({ status: 'pending' })
      expect(mockSet).not.toHaveBeenCalled()
    })

    it('reserves the mint (does not consume) for a matching secret', async () => {
      mockGet.mockResolvedValue(storedApproval())
      mockSet.mockResolvedValue('OK')
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({
        status: 'approved',
        userId: 'user-1',
        scope: 'copilot',
        workspaceId: null,
        workspaceBound: false,
      })
      // NX lock on the mint key; TTL matches the approval so they expire together
      // and a failed cleanup can't leave a re-mintable window. Record not deleted here.
      const [key, val, px, ttl, nx] = mockSet.mock.calls[0]
      expect(key).toContain('cli:auth:mint:')
      expect([val, px, ttl, nx]).toEqual(['1', 'PX', 120_000, 'NX'])
      expect(mockDel).not.toHaveBeenCalled()
    })

    it('returns the recorded scope and workspace binding', async () => {
      mockGet.mockResolvedValue(
        storedApproval({ scope: 'platform', workspaceId: 'ws-1', workspaceBound: true })
      )
      mockSet.mockResolvedValue('OK')
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({
        status: 'approved',
        userId: 'user-1',
        scope: 'platform',
        workspaceId: 'ws-1',
        workspaceBound: true,
      })
    })

    it('reports an unbound workspace pick as a default, not a key scope', async () => {
      mockGet.mockResolvedValue(storedApproval({ scope: 'platform', workspaceId: 'ws-1' }))
      mockSet.mockResolvedValue('OK')
      await expect(pollApproval(REQUEST, SECRET)).resolves.toMatchObject({
        workspaceId: 'ws-1',
        workspaceBound: false,
      })
    })

    it('treats a record written before scopes existed as a copilot approval', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({ challenge: CHALLENGE, userId: 'user-1', createdAt: Date.now() })
      )
      mockSet.mockResolvedValue('OK')
      await expect(pollApproval(REQUEST, SECRET)).resolves.toMatchObject({ scope: 'copilot' })
    })

    it('does NOT touch the record when the secret is wrong', async () => {
      mockGet.mockResolvedValue(storedApproval())
      await expect(pollApproval(REQUEST, 'c'.repeat(43))).resolves.toEqual({ status: 'pending' })
      expect(mockSet).not.toHaveBeenCalled()
    })

    it('yields to a concurrent poll already holding the mint lock', async () => {
      mockGet.mockResolvedValue(storedApproval())
      mockSet.mockResolvedValue(null) // NX lost — someone else is minting
      await expect(pollApproval(REQUEST, SECRET)).resolves.toEqual({ status: 'pending' })
    })
  })

  describe('completeApproval / releaseMint', () => {
    it('completeApproval deletes both the approval and the mint lock', async () => {
      mockDel.mockResolvedValue(2)
      await completeApproval(REQUEST)
      const keys = mockDel.mock.calls[0]
      expect(keys.some((k: string) => k.includes('cli:auth:req:'))).toBe(true)
      expect(keys.some((k: string) => k.includes('cli:auth:mint:'))).toBe(true)
    })

    it('releaseMint drops only the mint lock, leaving the approval for a retry', async () => {
      mockDel.mockResolvedValue(1)
      await releaseMint(REQUEST)
      expect(mockDel).toHaveBeenCalledTimes(1)
      expect(mockDel.mock.calls[0][0]).toContain('cli:auth:mint:')
      expect(mockDel.mock.calls[0].join(' ')).not.toContain('cli:auth:req:')
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
