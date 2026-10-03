import { describe, expect, it, vi } from 'vitest'

const { getLatestSeq, getOldestSeq, readEvents } = vi.hoisted(() => ({
  getLatestSeq: vi.fn(),
  getOldestSeq: vi.fn(),
  readEvents: vi.fn(),
}))

vi.mock('./buffer', () => ({
  getLatestSeq,
  getOldestSeq,
  readEvents,
}))

import {
  findReplayGap,
  replayGapTerminal,
  ringCanServe,
} from '@/lib/mothership/request/session/recovery'

describe('replay gap', () => {
  it('uses the latest buffered request id when run metadata is missing it', async () => {
    getOldestSeq.mockResolvedValue(10)
    getLatestSeq.mockResolvedValue(12)
    readEvents.mockResolvedValue([
      {
        trace: { requestId: 'req-live-123' },
      },
    ])

    const gap = await findReplayGap('stream-1', '1')
    expect(gap).not.toBeNull()
    const result = await replayGapTerminal('stream-1', gap!)

    expect(readEvents).toHaveBeenCalledWith('stream-1', '11')
    expect(result?.gapDetected).toBe(true)
    expect(result?.envelopes[0].trace.requestId).toBe('req-live-123')
    expect(result?.envelopes[1].trace.requestId).toBe('req-live-123')
  })

  it('cannot serve a reader that holds a cursor from an empty ring', () => {
    expect(ringCanServe({ requestedAfterSeq: 12, oldestSeq: 0, latestSeq: 0 })).toBe(false)
    expect(ringCanServe({ requestedAfterSeq: 0, oldestSeq: 0, latestSeq: 0 })).toBe(true)
  })
})
