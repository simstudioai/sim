import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { describe, expect, it, vi } from 'vitest'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { StreamBatchEvent } from '@/lib/mothership/request/session/types'
import {
  getReplayCompletedWorkflowToolCallIds,
  reconcileLiveAssistantTurn,
  selectReconnectReplayState,
} from '@/app/workspace/[workspaceId]/home/hooks/message-reconcile'
import {
  selectDeletedWorkflowResources,
  shouldQueueOutgoingMessage,
  waitForDetachedChatResolution,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

nextNavigationMockFns.mockUsePathname.mockReturnValue('/workspace/workspace-1/home')

vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: () => false,
}))

vi.mock('next/navigation', () => nextNavigationMock)

describe('selectDeletedWorkflowResources', () => {
  const resource = (id: string) => ({ type: 'workflow' as const, id, title: id })
  const cached = (id: string) => ({
    id,
    name: id,
    lastModified: new Date(0),
    createdAt: new Date(0),
    sortOrder: 0,
  })

  it('keeps a workflow the stream inserted into the cache after the list snapshot', () => {
    expect(
      selectDeletedWorkflowResources([resource('wf-new')], new Set(), [cached('wf-new')])
    ).toEqual([])
  })
})

describe('shouldQueueOutgoingMessage', () => {
  it('queues behind messages still waiting after the turn ended', () => {
    // The regression: a message queued mid-stream must dispatch before one
    // typed in the idle gap after the turn stopped — a direct send here would
    // jump the queue and swap the user's message order.
    expect(shouldQueueOutgoingMessage(false, false, 1)).toBe(true)
  })
})

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

describe('waitForDetachedChatResolution', () => {
  it('does not continue resolution after cancellation', async () => {
    const controller = new AbortController()
    const resolve = vi.fn(async () => {
      controller.abort('test cancellation')
      return { terminal: false }
    })

    await expect(waitForDetachedChatResolution(resolve, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(resolve).toHaveBeenCalledOnce()
  })
})

describe('reconcileLiveAssistantTurn', () => {
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
