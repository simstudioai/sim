import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { CopilotResumeOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'

const { getLatestRunForStream, readEvents, readFilePreviewSessions, findReplayGap } = vi.hoisted(
  () => ({
    getLatestRunForStream: vi.fn(),
    readEvents: vi.fn(),
    readFilePreviewSessions: vi.fn(),
    findReplayGap: vi.fn(),
  })
)

vi.mock('@/lib/mothership/request/application/recover-stream', () => ({
  readChatStream: { execute: getLatestRunForStream },
}))

vi.mock('@/lib/mothership/request/session', () => ({
  isTerminalStreamStatus: (status: string | null | undefined) =>
    status === 'complete' || status === 'error' || status === 'cancelled',
  readEvents,
  readFilePreviewSessions,
  findReplayGap,
  readRingPosition: async () => ({ requestedAfterSeq: 0, oldestSeq: 0, latestSeq: 0 }),
  ringCanServe: () => true,
  replayGapTerminal: async () => ({ gapDetected: true, envelopes: [] }),
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

import { GET as routeGET } from './route'

const GET = (request: NextRequest) => routeGET(request, { params: Promise.resolve({}) })

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
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    readEvents.mockResolvedValue([])
    readFilePreviewSessions.mockResolvedValue([])
    findReplayGap.mockResolvedValue(null)
  })

  it('refuses replay after organization membership is removed', async () => {
    getLatestRunForStream.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Chat not found')
    )
    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&batch=true')
    )
    expect(response.status).toBe(404)
    expect(readEvents).not.toHaveBeenCalled()
    expect(readFilePreviewSessions).not.toHaveBeenCalled()
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

  it.each([0, 2 * 60 * 60_000])(
    'delivers cancellation after %i ms of replay',
    async (elapsedMs) => {
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      readEvents.mockImplementationOnce(async () => {
        clock.mockReturnValue(now + elapsedMs)
        return []
      })
      getLatestRunForStream
        .mockResolvedValueOnce({
          status: 'active',
          executionId: 'exec-1',
          id: 'run-1',
        })
        .mockResolvedValue({
          status: 'cancelled',
          executionId: 'exec-1',
          id: 'run-1',
        })

      const response = await GET(
        new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
      )

      const chunks = await readAllChunks(response)
      if (elapsedMs >= 3_600_000) {
        expect(chunks.join('')).not.toContain('"type":"complete"')
        const reattached = await GET(
          new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
        )
        chunks.push(...(await readAllChunks(reattached)))
      }
      expect(chunks[0]).toBe(': accepted\n\n')
      expect(chunks.join('')).toContain(
        JSON.stringify({
          status: MothershipStreamV1CompletionStatus.cancelled,
          reason: 'terminal_status',
        })
      )
      expect(getLatestRunForStream).toHaveBeenCalledTimes(elapsedMs >= 3_600_000 ? 3 : 2)
      clock.mockRestore()
    }
  )

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

  it('ends a still-running replay at its cap without a terminal so the client re-attaches', async () => {
    const exporter = new InMemorySpanExporter()
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    )
    vi.useFakeTimers()
    getLatestRunForStream.mockResolvedValue({
      status: 'active',
      executionId: 'exec-1',
      id: 'run-1',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=7')
    )
    const body = readAllChunks(response)
    await vi.advanceTimersByTimeAsync(61 * 60 * 1000)
    const text = (await body).join('')

    expect(text).toContain(': keepalive')
    expect(text).not.toContain(`"type":"${MothershipStreamV1EventType.error}"`)
    expect(text).not.toContain(`"type":"${MothershipStreamV1EventType.complete}"`)
    const resume = exporter
      .getFinishedSpans()
      .find((span) => span.name === TraceSpan.CopilotResumeRequest)
    expect(resume?.attributes[TraceAttr.CopilotResumeOutcome]).toBe(
      CopilotResumeOutcome.EndedWithoutTerminal
    )
    trace.disable()
  })

  it('never delivers a ring read that starts past the reader cursor, and ends without a terminal', async () => {
    getLatestRunForStream.mockResolvedValue({
      status: 'active',
      executionId: 'exec-1',
      id: 'run-1',
    })
    readEvents.mockResolvedValue([
      {
        stream: { streamId: 'stream-1', cursor: '5' },
        seq: 5,
        trace: { requestId: 'req-1' },
        type: MothershipStreamV1EventType.text,
        payload: { channel: 'assistant', text: 'the middle of the turn' },
      },
    ])

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
    )
    const text = (await readAllChunks(response)).join('')

    expect(text).not.toContain('the middle of the turn')
    expect(text).not.toContain(`"type":"${MothershipStreamV1EventType.complete}"`)
  })

  it('serves a batch read that starts past the reader cursor no events', async () => {
    getLatestRunForStream.mockResolvedValue({
      status: 'active',
      executionId: 'exec-1',
      id: 'run-1',
    })
    readEvents.mockResolvedValue([
      {
        stream: { streamId: 'stream-1', cursor: '5' },
        seq: 5,
        trace: { requestId: 'req-1' },
        type: MothershipStreamV1EventType.text,
        payload: { channel: 'assistant', text: 'the middle of the turn' },
      },
    ])

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0&batch=true'
      )
    )

    await expect(response.json()).resolves.toMatchObject({ success: true, events: [] })
  })

  it('ends a live tail without a terminal when the ring trims past its cursor mid-tail', async () => {
    getLatestRunForStream.mockResolvedValue({
      status: 'active',
      executionId: 'exec-1',
      id: 'run-1',
    })
    const event = (seq: number, text: string) => ({
      stream: { streamId: 'stream-1', cursor: String(seq) },
      seq,
      trace: { requestId: 'req-1' },
      type: MothershipStreamV1EventType.text,
      payload: { channel: 'assistant', text },
    })
    readEvents
      .mockResolvedValueOnce([event(1, 'the start of the turn')])
      .mockResolvedValue([event(5, 'past a trimmed gap')])

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat/stream?streamId=stream-1&after=0')
    )
    const text = (await readAllChunks(response)).join('')

    expect(text).toContain('the start of the turn')
    expect(text).not.toContain('past a trimmed gap')
    expect(text).not.toContain(`"type":"${MothershipStreamV1EventType.complete}"`)
  })
})
