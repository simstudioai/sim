/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'
import {
  getReplayCompletedWorkflowToolCallIds,
  reconcileLiveAssistantTurn,
  selectReconnectReplayState,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/home',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}))

function userMessage(id: string): PersistedMessage {
  return {
    id,
    role: 'user',
    content: 'Question',
    timestamp: '2026-05-08T00:00:00.000Z',
  }
}

function assistantMessage(id: string, content: string): PersistedMessage {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: '2026-05-08T00:00:01.000Z',
  }
}

function toolBatchEvent(
  eventId: number,
  toolCallId: string,
  toolName: string,
  phase: MothershipStreamV1ToolPhase
): StreamBatchEvent {
  return {
    eventId,
    streamId: 'stream-1',
    event: {
      v: 1,
      seq: eventId,
      ts: '2026-05-08T00:00:00.000Z',
      type: MothershipStreamV1EventType.tool,
      stream: { streamId: 'stream-1' },
      payload: {
        phase,
        toolCallId,
        toolName,
      },
    },
  } as StreamBatchEvent
}

describe('reconcileLiveAssistantTurn', () => {
  it('replaces the live assistant for the active stream owner', () => {
    const liveAssistant = assistantMessage('live-assistant:stream-1', 'updated')
    const messages = [userMessage('stream-1'), assistantMessage('live-assistant:stream-1', 'old')]

    const result = reconcileLiveAssistantTurn({
      messages,
      streamId: 'stream-1',
      liveAssistant,
      activeStreamId: 'stream-1',
    })

    expect(result).toEqual([userMessage('stream-1'), liveAssistant])
  })

  it('replaces the generated assistant after the owner while the stream is active', () => {
    const liveAssistant = assistantMessage('live-assistant:stream-1', 'live content')

    const result = reconcileLiveAssistantTurn({
      messages: [userMessage('stream-1'), assistantMessage('final-1', 'persisted content')],
      streamId: 'stream-1',
      liveAssistant,
      activeStreamId: 'stream-1',
    })

    expect(result).toEqual([userMessage('stream-1'), liveAssistant])
  })

  it('leaves a terminal persisted assistant alone when the stream is no longer active', () => {
    const messages = [userMessage('stream-1'), assistantMessage('final-1', 'persisted content')]

    const result = reconcileLiveAssistantTurn({
      messages,
      streamId: 'stream-1',
      liveAssistant: assistantMessage('live-assistant:stream-1', 'stale live content'),
      activeStreamId: null,
    })

    expect(result).toBe(messages)
  })

  it('removes stale live assistant duplicates when a terminal persisted assistant exists', () => {
    const finalAssistant = assistantMessage('final-1', 'persisted content')
    const staleLiveAssistant = assistantMessage('live-assistant:stream-1', 'stale live content')

    const result = reconcileLiveAssistantTurn({
      messages: [
        userMessage('stream-1'),
        finalAssistant,
        userMessage('next-user'),
        staleLiveAssistant,
      ],
      streamId: 'stream-1',
      liveAssistant: staleLiveAssistant,
      activeStreamId: null,
    })

    expect(result).toEqual([userMessage('stream-1'), finalAssistant, userMessage('next-user')])
  })

  it('inserts the live assistant immediately after its owner', () => {
    const nextUser = userMessage('next-user')
    const liveAssistant = assistantMessage('live-assistant:stream-1', 'live content')

    const result = reconcileLiveAssistantTurn({
      messages: [userMessage('stream-1'), nextUser],
      streamId: 'stream-1',
      liveAssistant,
      activeStreamId: 'stream-1',
    })

    expect(result).toEqual([userMessage('stream-1'), liveAssistant, nextUser])
  })
})

describe('selectReconnectReplayState', () => {
  it('continues from a nonzero cursor when live streaming state exists in memory', () => {
    const currentBlock: ContentBlock = { type: 'text', content: 'Hello world' }

    const result = selectReconnectReplayState({
      afterCursor: '4',
      currentContent: 'Hello world',
      currentBlocks: [currentBlock],
    })

    expect(result).toEqual({
      afterCursor: '4',
      preserveExistingState: true,
      source: 'live',
    })
  })

  it('continues when only blocks carry live state (e.g. tool-only turn)', () => {
    const result = selectReconnectReplayState({
      afterCursor: '4',
      currentContent: '',
      currentBlocks: [{ type: 'tool_call', toolCall: { id: 't1', name: 'grep' } } as ContentBlock],
    })

    expect(result).toEqual({
      afterCursor: '4',
      preserveExistingState: true,
      source: 'live',
    })
  })

  it('replays the buffer from seq 0 when a nonzero cursor has no live in-memory state', () => {
    const result = selectReconnectReplayState({
      afterCursor: '4',
      currentContent: '',
      currentBlocks: [],
    })

    expect(result).toEqual({
      afterCursor: '0',
      preserveExistingState: false,
      source: 'reset',
    })
  })

  it('resets for cursor zero replay even when local state exists', () => {
    const currentBlock: ContentBlock = { type: 'text', content: 'Hello' }

    const result = selectReconnectReplayState({
      afterCursor: '0',
      currentContent: 'Hello',
      currentBlocks: [currentBlock],
    })

    expect(result).toEqual({
      afterCursor: '0',
      preserveExistingState: false,
      source: 'reset',
    })
  })
})

describe('getReplayCompletedWorkflowToolCallIds', () => {
  it('suppresses only workflow tool starts that already have results in the replay batch', () => {
    const result = getReplayCompletedWorkflowToolCallIds([
      toolBatchEvent(1, 'workflow-active', 'run_workflow', MothershipStreamV1ToolPhase.call),
      toolBatchEvent(2, 'search-complete', 'tool_search', MothershipStreamV1ToolPhase.result),
      toolBatchEvent(3, 'workflow-complete', 'run_workflow', MothershipStreamV1ToolPhase.result),
    ])

    expect(result).toEqual(new Set(['workflow-complete']))
  })
})
