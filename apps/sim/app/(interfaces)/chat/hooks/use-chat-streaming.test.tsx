/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadSSEEvents } = vi.hoisted(() => ({
  mockReadSSEEvents: vi.fn(),
}))

vi.mock('@/lib/core/utils/sse', () => ({
  readSSEEvents: mockReadSSEEvents,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'msg-assistant-1',
}))

import { isChatChunkFrame } from '@/lib/workflows/streaming/agent-stream-protocol'
import type { ChatMessage } from '@/app/(interfaces)/chat/components/message/message'
import { useChatStreaming } from '@/app/(interfaces)/chat/hooks/use-chat-streaming'

describe('isChatChunkFrame', () => {
  it('rejects thinking / stream_error / tool frames even if chunk is present', () => {
    expect(
      isChatChunkFrame({ blockId: 'a1', chunk: 'leak', event: 'thinking', data: 'thought' })
    ).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'x', event: 'stream_error' })).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'x', event: 'tool' })).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'x', event: 'final' })).toBe(false)
  })
})

interface HookHandle {
  latest: () => ReturnType<typeof useChatStreaming>
  unmount: () => void
}

function renderStreamingHook(): HookHandle {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest!: ReturnType<typeof useChatStreaming>

  function Probe() {
    latest = useChatStreaming()
    return null
  }

  act(() => {
    root.render(<Probe />)
  })

  return {
    latest: () => latest,
    unmount: () => {
      act(() => {
        root.unmount()
      })
    },
  }
}

function makeSseResponse(): Response {
  return {
    body: new ReadableStream(),
  } as Response
}

async function flushUiBatch() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60)
    })
  })
}

describe('useChatStreaming thinking + abort', () => {
  let handle: HookHandle
  let messages: ChatMessage[]
  let setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>

  beforeEach(() => {
    messages = []
    setMessages = ((updater: React.SetStateAction<ChatMessage[]>) => {
      messages = typeof updater === 'function' ? updater(messages) : updater
    }) as React.Dispatch<React.SetStateAction<ChatMessage[]>>
    handle = renderStreamingHook()

    // Run rAF immediately so UI batching is deterministic in tests.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now())
      return 1
    })
  })

  afterEach(() => {
    handle.unmount()
    vi.restoreAllMocks()
  })

  it('clears a block’s live text on chunk_reset and keeps the re-streamed final turn', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      // Turn 1: live preamble, then tools follow → reset.
      await options.onEvent({ blockId: 'agent-1', chunk: 'Let me check the weather…' })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'start',
        id: 't1',
        name: 'get_weather',
      })
      await options.onEvent({ blockId: 'agent-1', event: 'chunk_reset' })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'end',
        id: 't1',
        name: 'get_weather',
        status: 'success',
      })
      // Turn 2: final answer streams live.
      await options.onEvent({ blockId: 'agent-1', chunk: 'It is ' })
      await options.onEvent({ blockId: 'agent-1', chunk: '68°F.' })
      await options.onEvent({
        event: 'final',
        data: { success: true, output: {} },
      })
    })

    await act(async () => {
      await handle.latest().handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn())
    })
    await flushUiBatch()

    const assistant = messages.find((m) => m.id === 'msg-assistant-1')
    expect(assistant?.content).toBe('It is 68°F.')
    expect(assistant?.content).not.toContain('Let me check')
  })

  it('re-registers a reset block at the end so multi-block order matches arrival', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      // Agent A streams provisional text, then resets (tools follow).
      await options.onEvent({ blockId: 'agent-a', chunk: 'Checking the weather…' })
      await options.onEvent({ blockId: 'agent-a', event: 'chunk_reset' })
      // Another block streams while A's tools run.
      await options.onEvent({ blockId: 'block-b', chunk: 'B output' })
      // A's final turn re-streams; the server bakes in the cross-block separator.
      await options.onEvent({ blockId: 'agent-a', chunk: '\n\nIt is 68°F.' })
      await options.onEvent({
        event: 'final',
        data: { success: true, output: {} },
      })
    })

    await act(async () => {
      await handle.latest().handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn())
    })
    await flushUiBatch()

    const assistant = messages.find((m) => m.id === 'msg-assistant-1')
    expect(assistant?.content).toBe('B output\n\nIt is 68°F.')
  })

  it('does not append thinking payload into answer when mislabeled as chunk', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        chunk: 'SHOULD_NOT_APPEND',
        data: 'real thought',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'ok',
      })
      await options.onEvent({
        event: 'final',
        data: { success: true, output: {} },
      })
    })

    await act(async () => {
      await handle.latest().handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn())
    })
    await flushUiBatch()

    const assistant = messages.find((m) => m.id === 'msg-assistant-1')
    expect(assistant?.content).toBe('ok')
    expect(assistant?.thinking).toBe('real thought')
  })

  it('does not replace Stop notice with server Client cancelled request error', async () => {
    const abortController = new AbortController()
    let resolveStream!: () => void
    const streamDone = new Promise<void>((resolve) => {
      resolveStream = resolve
    })

    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'partial answer',
      })
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener(
          'abort',
          () => {
            // Server still emits terminal cancel error while the reader finishes.
            void options.onEvent({
              event: 'error',
              error: 'Client cancelled request',
            })
            resolve()
          },
          { once: true }
        )
        streamDone.then(() => resolve())
      })
    })

    const streamPromise = act(async () => {
      await handle
        .latest()
        .handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn(), {
          abortController,
        })
    })

    await flushUiBatch()

    act(() => {
      handle.latest().stopStreaming(setMessages)
    })
    resolveStream()
    await streamPromise

    const assistant = messages.find((m) => m.id === 'msg-assistant-1')
    expect(String(assistant?.content)).toContain('partial answer')
    expect(String(assistant?.content)).toContain('Response stopped by user')
    expect(String(assistant?.content)).not.toContain('Client cancelled request')
    expect(assistant?.isStreaming).toBe(false)
  })
})

describe('useChatStreaming tool lifecycle', () => {
  let handle: HookHandle
  let messages: ChatMessage[]
  let setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>

  beforeEach(() => {
    messages = []
    setMessages = ((updater: React.SetStateAction<ChatMessage[]>) => {
      messages = typeof updater === 'function' ? updater(messages) : updater
    }) as React.Dispatch<React.SetStateAction<ChatMessage[]>>
    handle = renderStreamingHook()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now())
      return 1
    })
  })

  afterEach(() => {
    handle.unmount()
    vi.restoreAllMocks()
  })

  it('tracks parallel tools and cancels running chips on Stop', async () => {
    const abortController = new AbortController()
    let resolveStream!: () => void
    const streamDone = new Promise<void>((resolve) => {
      resolveStream = resolve
    })

    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'start',
        id: 'toolu_1',
        name: 'http_request',
      })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'start',
        id: 'toolu_2',
        name: 'function_execute',
      })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'end',
        id: 'toolu_2',
        name: 'function_execute',
        status: 'success',
      })
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
        streamDone.then(() => resolve())
      })
    })

    const streamPromise = act(async () => {
      await handle
        .latest()
        .handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn(), {
          abortController,
        })
    })

    await flushUiBatch()
    expect(messages.find((m) => m.id === 'msg-assistant-1')?.toolCalls).toHaveLength(2)

    act(() => {
      handle.latest().stopStreaming(setMessages)
    })
    resolveStream()
    await streamPromise

    const tools = messages.find((m) => m.id === 'msg-assistant-1')?.toolCalls
    expect(tools?.find((t) => t.id === 'toolu_1')?.status).toBe('cancelled')
    expect(tools?.find((t) => t.id === 'toolu_2')?.status).toBe('success')
    expect(messages.find((m) => m.id === 'msg-assistant-1')?.isToolStreaming).toBe(false)
  })
})
