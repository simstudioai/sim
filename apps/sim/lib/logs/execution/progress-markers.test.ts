import { redisConfigMockFns, resetRedisConfigMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionLastCompletedBlock, ExecutionLastStartedBlock } from '@/lib/logs/types'

const { mockRedis } = vi.hoisted(() => {
  const mockRedis = {
    eval: vi.fn(),
    hgetall: vi.fn(),
    del: vi.fn(),
  }
  return { mockRedis }
})

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

afterAll(resetRedisConfigMock)

vi.mock('@/lib/core/execution-limits', () => ({
  getExecutionReservationTtlMs: () => 5_460_000,
}))

import {
  getProgressMarkers,
  pickLatestCompletedMarker,
  pickLatestStartedMarker,
  setLastStartedBlock,
} from '@/lib/logs/execution/progress-markers'

const EXECUTION_ID = 'exec-1'
const KEY = `execution:progress:${EXECUTION_ID}`
const EXPECTED_EXPIRY_AT = 1_785_000_000_000

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
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.eval.mockResolvedValue(1)
    mockRedis.hgetall.mockResolvedValue({})
    mockRedis.del.mockResolvedValue(1)
  })

  describe('setLastStartedBlock', () => {
    it('evals the monotonic-guard script with the exact execution expiry', async () => {
      await setLastStartedBlock(EXECUTION_ID, startedMarker, EXPECTED_EXPIRY_AT)

      expect(mockRedis.eval).toHaveBeenCalledTimes(1)
      const [, numKeys, key, field, timestampField, timestamp, json, expiresAt] =
        mockRedis.eval.mock.calls[0]
      expect(numKeys).toBe(1)
      expect(key).toBe(KEY)
      expect(field).toBe('started')
      expect(timestampField).toBe('startedAt')
      expect(timestamp).toBe(startedMarker.startedAt)
      expect(JSON.parse(json as string)).toEqual(startedMarker)
      expect(expiresAt).toBe(EXPECTED_EXPIRY_AT.toString())
    })

    it('returns false (caller falls back to SQL) when the eval fails', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('redis down'))
      await expect(setLastStartedBlock(EXECUTION_ID, startedMarker)).resolves.toBe(false)
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

    it('returns null when the Redis read fails so callers do not clear the only copy', async () => {
      mockRedis.hgetall.mockRejectedValueOnce(new Error('redis down'))
      expect(await getProgressMarkers(EXECUTION_ID)).toBeNull()
    })
  })

  describe('latest-wins pickers (stale-store safety)', () => {
    const older = { ...startedMarker, blockId: 'old', startedAt: '2026-06-27T10:00:00.000Z' }
    const newer = { ...startedMarker, blockId: 'new', startedAt: '2026-06-27T10:00:05.000Z' }

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
