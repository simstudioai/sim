/**
 * @vitest-environment node
 */

import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'

const { getLatestRunForStream, readEvents, readFilePreviewSessions, checkForReplayGap } =
  vi.hoisted(() => ({
    getLatestRunForStream: vi.fn(),
    readEvents: vi.fn(),
    readFilePreviewSessions: vi.fn(),
    checkForReplayGap: vi.fn(),
  }))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream,
}))

vi.mock('@/lib/copilot/request/session', () => ({
  readEvents,
  readFilePreviewSessions,
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
  encodeSSEComment: (comment: string) => new TextEncoder().encode(`: ${comment}\n\n`),
  SSE_RESPONSE_HEADERS: {
    'Content-Type': 'text/event-stream',
  },
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

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
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    readEvents.mockResolvedValue([])
    readFilePreviewSessions.mockResolvedValue([])
    checkForReplayGap.mockResolvedValue(null)
  })

  it('returns preview sessions in batch mode', async () => {
    getLatestRunForStream.mockResolvedValue({
      status: 'active',
      executionId: 'exec-1',
      id: 'run-1',
    })
    readFilePreviewSessions.mockResolvedValue([
      {
        schemaVersion: 1,
        id: 'preview-1',
        streamId: 'stream-1',
        toolCallId: 'preview-1',
        status: 'streaming',
        fileName: 'draft.md',
        previewText: 'hello',
        previewVersion: 2,
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
    ])

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0&batch=true'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      previewSessions: [
        expect.objectContaining({
          id: 'preview-1',
          previewText: 'hello',
          previewVersion: 2,
        }),
      ],
      status: 'active',
    })
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
    expect(chunks[0]).toBe(': accepted\n\n')
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

  it('uses the latest live request id for synthetic terminal replay events', async () => {
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
    readEvents
      .mockResolvedValueOnce([
        {
          stream: { streamId: 'stream-1', cursor: '1' },
          seq: 1,
          trace: { requestId: 'req-live-123' },
          type: MothershipStreamV1EventType.text,
          payload: {
            channel: 'assistant',
            text: 'hello',
          },
        },
      ])
      .mockResolvedValueOnce([])

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
    )

    const chunks = await readAllChunks(response)
    const terminalChunk = chunks[chunks.length - 1] ?? ''
    expect(terminalChunk).toContain(`"type":"${MothershipStreamV1EventType.complete}"`)
    expect(terminalChunk).toContain('"requestId":"req-live-123"')
    expect(terminalChunk).toContain('"status":"cancelled"')
  })
})
