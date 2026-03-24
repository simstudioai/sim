/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getStreamMeta, readStreamEvents, authenticateCopilotRequestSessionOnly } = vi.hoisted(
  () => ({
    getStreamMeta: vi.fn(),
    readStreamEvents: vi.fn(),
    authenticateCopilotRequestSessionOnly: vi.fn(),
  })
)

vi.mock('@/lib/copilot/orchestrator/stream/buffer', () => ({
  getStreamMeta,
  readStreamEvents,
}))

vi.mock('@/lib/copilot/request-helpers', () => ({
  authenticateCopilotRequestSessionOnly,
}))

import { GET } from '@/app/api/copilot/chat/stream/route'

describe('copilot chat stream replay route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    readStreamEvents.mockResolvedValue([])
  })

  it('stops replay polling when stream meta becomes cancelled', async () => {
    getStreamMeta
      .mockResolvedValueOnce({
        status: 'active',
        userId: 'user-1',
      })
      .mockResolvedValueOnce({
        status: 'cancelled',
        userId: 'user-1',
      })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1')
    )

    const reader = response.body?.getReader()
    expect(reader).toBeTruthy()

    const first = await reader!.read()
    expect(first.done).toBe(true)
    expect(getStreamMeta).toHaveBeenCalledTimes(2)
  })
})
