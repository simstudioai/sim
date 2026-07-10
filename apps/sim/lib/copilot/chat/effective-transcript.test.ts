/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  buildEffectiveChatTranscript,
  getLiveAssistantMessageId,
  isLiveAssistantMessageId,
} from '@/lib/copilot/chat/effective-transcript'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolOutcome,
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

  it('pairs a scoped compaction inside the owning subagent during stream replay', () => {
    const scope = {
      lane: 'subagent' as const,
      parentToolCallId: 'tc-workflow',
      spanId: 'span-workflow',
      parentSpanId: 'span-superagent',
      agentId: 'superagent',
    }
    const stream = { streamId: 'stream-1' }
    const result = buildEffectiveChatTranscript({
      messages: [buildUserMessage('stream-1', 'Hello')],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [
          toBatchEvent(1, {
            v: 1,
            seq: 1,
            ts: '2026-04-15T12:00:01.000Z',
            type: MothershipStreamV1EventType.span,
            stream,
            scope,
            payload: {
              kind: MothershipStreamV1SpanPayloadKind.subagent,
              event: MothershipStreamV1SpanLifecycleEvent.start,
              agent: 'workflow',
              data: { tool_call_id: 'tc-workflow' },
            },
          }),
          toBatchEvent(2, {
            v: 1,
            seq: 2,
            ts: '2026-04-15T12:00:02.000Z',
            type: MothershipStreamV1EventType.run,
            stream,
            scope,
            payload: { kind: MothershipStreamV1RunKind.compaction_start },
          }),
          toBatchEvent(3, {
            v: 1,
            seq: 3,
            ts: '2026-04-15T12:00:03.000Z',
            type: MothershipStreamV1EventType.run,
            stream,
            scope,
            payload: {
              kind: MothershipStreamV1RunKind.compaction_done,
              data: { summary_chars: 42 },
            },
          }),
        ],
        previewSessions: [],
        status: 'active',
      },
    })

    const compactions = result[1]?.contentBlocks?.filter(
      (block) => block.type === MothershipStreamV1EventType.tool
    )
    expect(compactions).toHaveLength(1)
    expect(compactions?.[0]).toEqual(
      expect.objectContaining({
        parentToolCallId: 'tc-workflow',
        spanId: 'span-workflow',
        parentSpanId: 'span-superagent',
        toolCall: expect.objectContaining({
          id: 'compaction_2',
          name: 'context_compaction',
          calledBy: 'workflow',
          state: MothershipStreamV1ToolOutcome.success,
        }),
      })
    )
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

describe('isLiveAssistantMessageId', () => {
  it('recognizes the synthetic live-assistant id and nothing else', () => {
    expect(isLiveAssistantMessageId(getLiveAssistantMessageId('stream-1'))).toBe(true)
    expect(isLiveAssistantMessageId('f620fceb-4e9d-4e7f-ab7f-890a2a823564')).toBe(false)
    expect(isLiveAssistantMessageId('')).toBe(false)
  })
})
