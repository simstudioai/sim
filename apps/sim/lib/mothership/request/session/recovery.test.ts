/**
 * @vitest-environment node
 */

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

import { checkForReplayGap } from './recovery'

describe('checkForReplayGap', () => {
  it('uses the latest buffered request id when run metadata is missing it', async () => {
    getOldestSeq.mockResolvedValue(10)
    getLatestSeq.mockResolvedValue(12)
    readEvents.mockResolvedValue([
      {
        trace: { requestId: 'req-live-123' },
      },
    ])

    const result = await checkForReplayGap('stream-1', '1')

    expect(readEvents).toHaveBeenCalledWith('stream-1', '11')
    expect(result?.gapDetected).toBe(true)
    expect(result?.envelopes[0].trace.requestId).toBe('req-live-123')
    expect(result?.envelopes[1].trace.requestId).toBe('req-live-123')
  })
})
