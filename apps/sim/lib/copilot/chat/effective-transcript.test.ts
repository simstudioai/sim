/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  buildEffectiveChatTranscript,
  getLiveAssistantMessageId,
} from '@/lib/copilot/chat/effective-transcript'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'

function toBatchEvent(eventId: number, event: StreamBatchEvent['event']): StreamBatchEvent {
  return {
    eventId,
    streamId: event.stream.streamId,
    event,
  }
}

function buildUserMessage(id: string, content: string) {
  return normalizeMessage({
    id,
    role: 'user',
    content,
    timestamp: '2026-04-15T12:00:00.000Z',
  })
}

describe('buildEffectiveChatTranscript', () => {
  it('returns the existing transcript when the stream owner is no longer the trailing user', () => {
    const messages = [
      buildUserMessage('stream-1', 'Hello'),
      normalizeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Persisted response',
        timestamp: '2026-04-15T12:00:01.000Z',
      }),
    ]

    const result = buildEffectiveChatTranscript({
      messages,
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.text,
            stream: { streamId: 'stream-1' },
            payload: {
              channel: MothershipStreamV1TextChannel.assistant,
              text: 'Live response',
            },
          }),
        ],
        previewSessions: [],
        status: 'active',
      },
    })

    expect(result).toEqual(messages)
  })

  it('appends a placeholder assistant while an active stream has not produced text yet', () => {
    const result = buildEffectiveChatTranscript({
      messages: [buildUserMessage('stream-1', 'Hello')],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.session,
            stream: { streamId: 'stream-1' },
            payload: {
              kind: MothershipStreamV1SessionKind.start,
            },
          }),
        ],
        previewSessions: [],
        status: 'active',
      },
    })

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: getLiveAssistantMessageId('stream-1'),
        role: 'assistant',
        content: '',
      })
    )
  })

  it('materializes a live assistant response from redis-backed stream events', () => {
    const result = buildEffectiveChatTranscript({
      messages: [buildUserMessage('stream-1', 'Hello')],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.session,
            stream: { streamId: 'stream-1' },
            trace: { requestId: 'req-1' },
            payload: {
              kind: MothershipStreamV1SessionKind.trace,
              requestId: 'req-1',
            },
          }),
          toBatchEvent(2, {
            v: 1,
            seq: 2,
            ts: '2026-04-15T12:00:02.000Z',
            type: MothershipStreamV1EventType.text,
            stream: { streamId: 'stream-1' },
            trace: { requestId: 'req-1' },
            payload: {
              channel: MothershipStreamV1TextChannel.assistant,
              text: 'Live response',
            },
          }),
        ],
        previewSessions: [],
        status: 'active',
      },
    })

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: getLiveAssistantMessageId('stream-1'),
        role: 'assistant',
        content: 'Live response',
        requestId: 'req-1',
      })
    )
  })

  it('does not duplicate thinking-only text into a second assistant block', () => {
    const result = buildEffectiveChatTranscript({
      messages: [buildUserMessage('stream-1', 'Hello')],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.text,
            stream: { streamId: 'stream-1' },
            payload: {
              channel: MothershipStreamV1TextChannel.thinking,
              text: 'Internal reasoning',
            },
          }),
        ],
        previewSessions: [],
        status: 'active',
      },
    })

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual(
      expect.objectContaining({
        content: 'Internal reasoning',
        contentBlocks: [
          expect.objectContaining({
            type: MothershipStreamV1EventType.text,
            content: 'Internal reasoning',
          }),
        ],
      })
    )
  })

  it('treats user-cancelled tool results as cancelled', () => {
    const result = buildEffectiveChatTranscript({
      messages: [buildUserMessage('stream-1', 'Hello')],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.tool,
            stream: { streamId: 'stream-1' },
            payload: {
              phase: 'result',
              toolCallId: 'tool-1',
              toolName: 'workspace_file',
              executor: 'go',
              mode: 'sync',
              success: false,
              output: {
                reason: 'user_cancelled',
              },
            },
          }),
        ],
        previewSessions: [],
        status: 'active',
      },
    })

    expect(result[1]?.contentBlocks).toEqual([
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        toolCall: expect.objectContaining({
          id: 'tool-1',
          name: 'workspace_file',
          state: MothershipStreamV1CompletionStatus.cancelled,
        }),
      }),
    ])
  })

  it('materializes a cancelled assistant tail when the stream ends before persistence', () => {
    const result = buildEffectiveChatTranscript({
      messages: [buildUserMessage('stream-1', 'Hello')],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.complete,
            stream: { streamId: 'stream-1' },
            payload: {
              status: MothershipStreamV1CompletionStatus.cancelled,
            },
          }),
        ],
        previewSessions: [],
        status: MothershipStreamV1CompletionStatus.cancelled,
      },
    })

    expect(result).toHaveLength(2)
    expect(result[1]?.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: MothershipStreamV1EventType.complete,
          status: MothershipStreamV1CompletionStatus.cancelled,
        }),
      ])
    )
  })
})
