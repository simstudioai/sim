/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getLatestRunForStream,
  readEvents,
  checkForReplayGap,
  authenticateCopilotRequestSessionOnly,
} = vi.hoisted(() => ({
  getLatestRunForStream: vi.fn(),
  readEvents: vi.fn(),
  checkForReplayGap: vi.fn(),
  authenticateCopilotRequestSessionOnly: vi.fn(),
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream,
}))

vi.mock('@/lib/copilot/request/session', () => ({
  readEvents,
  checkForReplayGap,
  encodeSSEEnvelope: (event: Record<string, unknown>) =>
    new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
  SSE_RESPONSE_HEADERS: {
    'Content-Type': 'text/event-stream',
  },
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly,
}))

import { GET } from './route'

describe('copilot chat stream replay route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    readEvents.mockResolvedValue([])
    checkForReplayGap.mockResolvedValue(null)
  })

  it('stops replay polling when run becomes cancelled', async () => {
    getLatestRunForStream
      .mockResolvedValueOnce({
        status: 'active',
        executionId: 'exec-1',
        id: 'run-1',
      })
      .mockResolvedValueOnce({
        status: 'cancelled',
        executionId: 'exec-1',
        id: 'run-1',
      })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
    )

    const reader = response.body?.getReader()
    expect(reader).toBeTruthy()

    const first = await reader!.read()
    expect(first.done).toBe(true)
    expect(getLatestRunForStream).toHaveBeenCalledTimes(2)
  })
})
