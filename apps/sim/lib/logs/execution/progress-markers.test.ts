/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionLastCompletedBlock, ExecutionLastStartedBlock } from '@/lib/logs/types'

const { mockGetRedisClient, mockRedis } = vi.hoisted(() => {
  const mockRedis = {
    eval: vi.fn(),
    hgetall: vi.fn(),
    del: vi.fn(),
  }
  return { mockGetRedisClient: vi.fn<[], typeof mockRedis | null>(() => mockRedis), mockRedis }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

vi.mock('@/lib/core/execution-limits', () => ({
  getExecutionReservationTtlMs: () => 5_460_000,
}))

import {
  clearProgressMarkers,
  getProgressMarkers,
  pickLatestCompletedMarker,
  pickLatestStartedMarker,
  setLastCompletedBlock,
  setLastStartedBlock,
} from '@/lib/logs/execution/progress-markers'

const EXECUTION_ID = 'exec-1'
const KEY = `execution:progress:${EXECUTION_ID}`
const EXPECTED_TTL_MS = '5460000' // getExecutionReservationTtlMs() mock value

const startedMarker: ExecutionLastStartedBlock = {
  blockId: 'b1',
  blockName: 'Fetch',
  blockType: 'api',
  startedAt: '2026-06-27T10:00:00.000Z',
}

const completedMarker: ExecutionLastCompletedBlock = {
  blockId: 'b1',
  blockName: 'Fetch',
  blockType: 'api',
  endedAt: '2026-06-27T10:00:01.000Z',
  success: true,
}

describe('progress-markers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.eval.mockResolvedValue(1)
    mockRedis.hgetall.mockResolvedValue({})
    mockRedis.del.mockResolvedValue(1)
  })

  describe('setLastStartedBlock', () => {
    it('evals the monotonic-guard script with key, started field, timestamp, json, and TTL', async () => {
      await setLastStartedBlock(EXECUTION_ID, startedMarker)

      expect(mockRedis.eval).toHaveBeenCalledTimes(1)
      const [, numKeys, key, field, timestampField, timestamp, json, ttl] =
        mockRedis.eval.mock.calls[0]
      expect(numKeys).toBe(1)
      expect(key).toBe(KEY)
      expect(field).toBe('started')
      expect(timestampField).toBe('startedAt')
      expect(timestamp).toBe(startedMarker.startedAt)
      expect(JSON.parse(json as string)).toEqual(startedMarker)
      expect(ttl).toBe(EXPECTED_TTL_MS)
    })

    it('returns true when the Redis write succeeds', async () => {
      await expect(setLastStartedBlock(EXECUTION_ID, startedMarker)).resolves.toBe(true)
    })

    it('returns false (caller falls back to SQL) when the eval fails', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('redis down'))
      await expect(setLastStartedBlock(EXECUTION_ID, startedMarker)).resolves.toBe(false)
    })

    it('returns false and no-ops when Redis is unavailable', async () => {
      mockGetRedisClient.mockReturnValue(null)
      await expect(setLastStartedBlock(EXECUTION_ID, startedMarker)).resolves.toBe(false)
      expect(mockRedis.eval).not.toHaveBeenCalled()
    })
  })

  describe('setLastCompletedBlock', () => {
    it('evals with the completed field and endedAt timestamp', async () => {
      await setLastCompletedBlock(EXECUTION_ID, completedMarker)

      const args = mockRedis.eval.mock.calls[0]
      expect(args[3]).toBe('completed')
      expect(args[4]).toBe('endedAt')
      expect(args[5]).toBe(completedMarker.endedAt)
      expect(JSON.parse(args[6] as string)).toEqual(completedMarker)
    })
  })

  describe('getProgressMarkers', () => {
    it('parses both markers from the hash', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        started: JSON.stringify(startedMarker),
        completed: JSON.stringify(completedMarker),
      })

      const result = await getProgressMarkers(EXECUTION_ID)
      expect(mockRedis.hgetall).toHaveBeenCalledWith(KEY)
      expect(result).toEqual({
        lastStartedBlock: startedMarker,
        lastCompletedBlock: completedMarker,
      })
    })

    it('returns only the present field', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({ started: JSON.stringify(startedMarker) })
      const result = await getProgressMarkers(EXECUTION_ID)
      expect(result).toEqual({ lastStartedBlock: startedMarker })
    })

    it('returns {} for an empty / missing key', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({})
      expect(await getProgressMarkers(EXECUTION_ID)).toEqual({})
    })

    it('returns {} and does not throw on malformed JSON', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({ started: '{not json' })
      expect(await getProgressMarkers(EXECUTION_ID)).toEqual({})
    })

    it('drops wrong-shaped JSON so malformed markers never reach clients', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        started: JSON.stringify('just a string'),
        completed: JSON.stringify({ blockId: 123, blockName: 'x', blockType: 'api', endedAt: 'z' }),
      })
      expect(await getProgressMarkers(EXECUTION_ID)).toEqual({})
    })

    it('strips extra fields, returning only the validated marker shape', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        started: JSON.stringify({ ...startedMarker, secret: 'leak', extra: 1 }),
      })
      expect(await getProgressMarkers(EXECUTION_ID)).toEqual({ lastStartedBlock: startedMarker })
    })

    it('returns {} when Redis is unavailable', async () => {
      mockGetRedisClient.mockReturnValue(null)
      expect(await getProgressMarkers(EXECUTION_ID)).toEqual({})
      expect(mockRedis.hgetall).not.toHaveBeenCalled()
    })

    it('returns null when the Redis read fails so callers do not clear the only copy', async () => {
      mockRedis.hgetall.mockRejectedValueOnce(new Error('redis down'))
      expect(await getProgressMarkers(EXECUTION_ID)).toBeNull()
    })
  })

  describe('clearProgressMarkers', () => {
    it('deletes the key', async () => {
      await clearProgressMarkers(EXECUTION_ID)
      expect(mockRedis.del).toHaveBeenCalledWith(KEY)
    })

    it('swallows del errors', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('redis down'))
      await expect(clearProgressMarkers(EXECUTION_ID)).resolves.toBeUndefined()
    })

    it('no-ops when Redis is unavailable', async () => {
      mockGetRedisClient.mockReturnValue(null)
      await clearProgressMarkers(EXECUTION_ID)
      expect(mockRedis.del).not.toHaveBeenCalled()
    })
  })

  describe('latest-wins pickers (stale-store safety)', () => {
    const older = { ...startedMarker, blockId: 'old', startedAt: '2026-06-27T10:00:00.000Z' }
    const newer = { ...startedMarker, blockId: 'new', startedAt: '2026-06-27T10:00:05.000Z' }

    it('returns the defined side when the other is undefined', () => {
      expect(pickLatestStartedMarker(older, undefined)).toBe(older)
      expect(pickLatestStartedMarker(undefined, newer)).toBe(newer)
      expect(pickLatestStartedMarker(undefined, undefined)).toBeUndefined()
    })

    it('picks the later startedAt regardless of argument order (row newer than Redis still wins)', () => {
      expect(pickLatestStartedMarker(older, newer)).toBe(newer)
      expect(pickLatestStartedMarker(newer, older)).toBe(newer)
    })

    it('picks the later endedAt for completed markers', () => {
      const c1 = { ...completedMarker, endedAt: '2026-06-27T10:00:01.000Z' }
      const c2 = { ...completedMarker, endedAt: '2026-06-27T10:00:09.000Z' }
      expect(pickLatestCompletedMarker(c1, c2)).toBe(c2)
      expect(pickLatestCompletedMarker(c2, c1)).toBe(c2)
    })
  })
})
