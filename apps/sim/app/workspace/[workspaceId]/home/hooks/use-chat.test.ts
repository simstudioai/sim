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
  panelForExecutingClientTool,
  reconcileLiveAssistantTurn,
  selectDeletedWorkflowResources,
  selectReconnectReplayState,
  shouldActivateResourceEvent,
  shouldQueueOutgoingMessage,
  waitForDetachedChatResolution,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type {
  ChatMessage,
  ContentBlock,
  ToolCallStatus,
} from '@/app/workspace/[workspaceId]/home/types'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/home',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}))

describe('selectDeletedWorkflowResources', () => {
  const resource = (id: string) => ({ type: 'workflow' as const, id, title: id })
  const cached = (id: string) => ({
    id,
    name: id,
    lastModified: new Date(0),
    createdAt: new Date(0),
    sortOrder: 0,
  })

  it('selects a hydrated workflow the server no longer has', () => {
    expect(selectDeletedWorkflowResources([resource('wf-gone')], new Set(), [])).toEqual([
      resource('wf-gone'),
    ])
  })

  it('keeps a workflow present in the fetched list', () => {
    expect(selectDeletedWorkflowResources([resource('wf-1')], new Set(['wf-1']), [])).toEqual([])
  })

  it('keeps a workflow the stream inserted into the cache after the list snapshot', () => {
    expect(
      selectDeletedWorkflowResources([resource('wf-new')], new Set(), [cached('wf-new')])
    ).toEqual([])
  })
})

describe('shouldActivateResourceEvent', () => {
  it('requests activation for browser work', () => {
    expect(shouldActivateResourceEvent('file-1', 'browser-session')).toBe(true)
  })

  it('requests activation for every other resource the agent touches', () => {
    expect(shouldActivateResourceEvent('file-1', 'workflow-1')).toBe(true)
    expect(shouldActivateResourceEvent('browser-session', 'terminal-session')).toBe(true)
    expect(shouldActivateResourceEvent(null, 'browser-session')).toBe(true)
  })

  it('honors an explicit request to activate', () => {
    expect(shouldActivateResourceEvent('file-1', 'browser-session', { activate: true })).toBe(true)
  })

  it('lets an event opt out of stealing focus', () => {
    expect(shouldActivateResourceEvent('file-1', 'browser-session', { activate: false })).toBe(
      false
    )
  })
})

describe('shouldQueueOutgoingMessage', () => {
  it('queues while a send is in flight', () => {
    expect(shouldQueueOutgoingMessage(true, false, 0)).toBe(true)
  })

  it('queues while a stop is still settling', () => {
    expect(shouldQueueOutgoingMessage(false, true, 0)).toBe(true)
  })

  it('queues behind messages still waiting after the turn ended', () => {
    // The regression: a message queued mid-stream must dispatch before one
    // typed in the idle gap after the turn stopped — a direct send here would
    // jump the queue and swap the user's message order.
    expect(shouldQueueOutgoingMessage(false, false, 1)).toBe(true)
  })

  it('sends directly on an idle chat with an empty queue', () => {
    expect(shouldQueueOutgoingMessage(false, false, 0)).toBe(false)
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
  it('returns a durable chat owner without retrying', async () => {
    const resolve = vi.fn(async () => ({ chatId: 'chat-1', terminal: false }))

    await expect(
      waitForDetachedChatResolution(resolve, new AbortController().signal)
    ).resolves.toEqual({ chatId: 'chat-1', terminal: false })
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('returns a terminal result without retrying', async () => {
    const resolve = vi.fn(async () => ({ terminal: true }))

    await expect(
      waitForDetachedChatResolution(resolve, new AbortController().signal)
    ).resolves.toEqual({ terminal: true })
    expect(resolve).toHaveBeenCalledOnce()
  })

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

describe('panelForExecutingClientTool', () => {
  function toolCallMessage(id: string, name: string, status: ToolCallStatus): ChatMessage {
    return {
      id,
      role: 'assistant',
      content: '',
      contentBlocks: [{ type: 'tool_call', toolCall: { id: `${id}-tool`, name, status } }],
    }
  }

  it('detects a browser tool call that is still executing', () => {
    const messages = [
      toolCallMessage('m1', 'browser_click', 'success'),
      toolCallMessage('m2', 'browser_navigate', 'executing'),
    ]

    expect(panelForExecutingClientTool(messages)).toBe('browser')
  })

  it('detects a terminal tool call that is still executing', () => {
    const messages = [
      toolCallMessage('m1', 'terminal', 'success'),
      toolCallMessage('m2', 'terminal', 'executing'),
    ]

    expect(panelForExecutingClientTool(messages)).toBe('terminal')
  })

  it('ignores completed calls and executing tools that own no panel', () => {
    const messages = [
      toolCallMessage('m1', 'browser_click', 'success'),
      toolCallMessage('m2', 'terminal', 'success'),
      toolCallMessage('m3', 'run_workflow', 'executing'),
      { id: 'm4', role: 'assistant' as const, content: 'no blocks' },
    ]

    expect(panelForExecutingClientTool(messages)).toBe(null)
  })

  // Both panels can be in flight at once; the later call is the one the user
  // was watching when they navigated away.
  it('picks the later panel when both are mid-action', () => {
    const browserFirst = [
      toolCallMessage('m1', 'browser_navigate', 'executing'),
      toolCallMessage('m2', 'terminal', 'executing'),
    ]
    const terminalFirst = [
      toolCallMessage('m1', 'terminal', 'executing'),
      toolCallMessage('m2', 'browser_navigate', 'executing'),
    ]

    expect(panelForExecutingClientTool(browserFirst)).toBe('terminal')
    expect(panelForExecutingClientTool(terminalFirst)).toBe('browser')
  })
})
