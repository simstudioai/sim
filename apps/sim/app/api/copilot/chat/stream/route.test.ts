/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'

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
  createEvent: (event: Record<string, unknown>) => ({
    stream: {
      streamId: event.streamId,
      cursor: event.cursor,
    },
    seq: event.seq,
    trace: { requestId: event.requestId ?? '' },
    type: event.type,
    payload: event.payload,
  }),
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

async function readAllChunks(response: Response): Promise<string[]> {
  const reader = response.body?.getReader()
  expect(reader).toBeTruthy()

  const chunks: string[] = []
  while (true) {
    const { done, value } = await reader!.read()
    if (done) {
      break
    }
    chunks.push(new TextDecoder().decode(value))
  }
  return chunks
}

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

    const chunks = await readAllChunks(response)
    expect(chunks.join('')).toContain(
      JSON.stringify({
        status: MothershipStreamV1CompletionStatus.cancelled,
        reason: 'terminal_status',
      })
    )
    expect(getLatestRunForStream).toHaveBeenCalledTimes(2)
  })

  it('emits structured terminal replay error when run metadata disappears', async () => {
    getLatestRunForStream
      .mockResolvedValueOnce({
        status: 'active',
        executionId: 'exec-1',
        id: 'run-1',
      })
      .mockResolvedValueOnce(null)

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
    )

    const chunks = await readAllChunks(response)
    const body = chunks.join('')
    expect(body).toContain(`"type":"${MothershipStreamV1EventType.error}"`)
    expect(body).toContain('"code":"resume_run_unavailable"')
    expect(body).toContain(`"type":"${MothershipStreamV1EventType.complete}"`)
  })
})
