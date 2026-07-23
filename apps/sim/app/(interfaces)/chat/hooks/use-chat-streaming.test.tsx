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
  it('accepts plain answer chunks without an event type', () => {
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'hello' })).toBe(true)
  })

  it('rejects thinking / stream_error / tool frames even if chunk is present', () => {
    expect(
      isChatChunkFrame({ blockId: 'a1', chunk: 'leak', event: 'thinking', data: 'thought' })
    ).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'x', event: 'stream_error' })).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'x', event: 'tool' })).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: 'x', event: 'final' })).toBe(false)
  })

  it('rejects frames missing blockId or empty chunk', () => {
    expect(isChatChunkFrame({ chunk: 'hello' })).toBe(false)
    expect(isChatChunkFrame({ blockId: 'a1', chunk: '' })).toBe(false)
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
    vi.clearAllMocks()
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

  it('routes thinking to message.thinking and answer chunks to content only', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        data: 'Let me reason. ',
      })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        data: 'More thought.',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'Final answer.',
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
    expect(assistant?.thinking).toBe('Let me reason. More thought.')
    expect(assistant?.content).toBe('Final answer.')
    expect(assistant?.isStreaming).toBe(false)
    expect(assistant?.isThinkingStreaming).toBe(false)
  })

  it('ignores non-terminal stream_error frames and keeps streaming', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        data: 'Working…',
      })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'stream_error',
        error: 'partial provider glitch',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'Recovered answer.',
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
    // Error text never pollutes the thinking lane (legacy parity: log-only).
    expect(assistant?.thinking).toBe('Working…')
    expect(assistant?.content).toBe('Recovered answer.')
    expect(assistant?.isStreaming).toBe(false)
  })

  it('clears streaming flags when SSE ends without a terminal final/error frame', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        data: 'Halfway…',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'Partial answer',
      })
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'start',
        id: 't1',
        name: 'search',
      })
      // Stream closes abruptly — no final or error event.
    })

    await act(async () => {
      await handle.latest().handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn())
    })
    await flushUiBatch()

    const assistant = messages.find((m) => m.id === 'msg-assistant-1')
    expect(assistant?.content).toBe('Partial answer')
    expect(assistant?.thinking).toBe('Halfway…')
    expect(assistant?.isStreaming).toBe(false)
    expect(assistant?.isThinkingStreaming).toBe(false)
    expect(assistant?.isToolStreaming).toBe(false)
    expect(assistant?.toolCalls?.some((t) => t.status === 'error')).toBe(true)
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

  it('TTS audioStreamHandler receives answer text only', async () => {
    const audioStreamHandler = vi.fn().mockResolvedValue(undefined)

    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        data: 'secret internal monologue that must not be spoken.',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'Hello world.',
      })
      await options.onEvent({
        event: 'final',
        data: { success: true, output: {} },
      })
    })

    await act(async () => {
      await handle
        .latest()
        .handleStreamedResponse(makeSseResponse(), setMessages, vi.fn(), vi.fn(), {
          voiceSettings: {
            isVoiceEnabled: true,
            voiceId: 'voice-1',
            autoPlayResponses: true,
          },
          audioStreamHandler,
        })
    })
    await flushUiBatch()

    expect(audioStreamHandler).toHaveBeenCalled()
    for (const call of audioStreamHandler.mock.calls) {
      expect(String(call[0])).not.toContain('secret')
      expect(String(call[0])).not.toContain('monologue')
    }
    expect(audioStreamHandler.mock.calls.some((c) => String(c[0]).includes('Hello'))).toBe(true)
  })

  it('stopStreaming preserves thinking and aborts the shared controller', async () => {
    const abortController = new AbortController()
    let resolveStream!: () => void
    const streamDone = new Promise<void>((resolve) => {
      resolveStream = resolve
    })

    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'thinking',
        data: 'partial thought',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'partial answer',
      })
      // Hold the stream open until Stop aborts.
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
        // Also allow test cleanup if abort never fires.
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
    expect(messages.find((m) => m.id === 'msg-assistant-1')?.thinking).toBe('partial thought')

    act(() => {
      handle.latest().stopStreaming(setMessages)
    })
    resolveStream()
    await streamPromise

    const assistant = messages.find((m) => m.id === 'msg-assistant-1')
    expect(abortController.signal.aborted).toBe(true)
    expect(assistant?.thinking).toBe('partial thought')
    expect(String(assistant?.content)).toContain('partial answer')
    expect(String(assistant?.content)).toContain('Response stopped by user')
    expect(assistant?.isStreaming).toBe(false)
    expect(assistant?.isThinkingStreaming).toBe(false)
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

  it('leaves thinking undefined when no thinking events arrive', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'just text',
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
    expect(assistant?.thinking).toBeUndefined()
    expect(assistant?.content).toBe('just text')
  })
})

describe('useChatStreaming tool lifecycle', () => {
  let handle: HookHandle
  let messages: ChatMessage[]
  let setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('maps tool start/end into keyed chips without touching answer content', async () => {
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
        phase: 'end',
        id: 'toolu_1',
        name: 'http_request',
        status: 'success',
      })
      await options.onEvent({
        blockId: 'agent-1',
        chunk: 'https://httpbin.org/get',
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
    expect(assistant?.content).toBe('https://httpbin.org/get')
    expect(assistant?.toolCalls).toEqual([
      {
        key: 'agent-1:toolu_1',
        blockId: 'agent-1',
        id: 'toolu_1',
        name: 'http_request',
        displayName: 'Http Request',
        status: 'success',
      },
    ])
    expect(assistant?.toolCalls?.[0]).not.toHaveProperty('args')
    expect(assistant?.toolCalls?.[0]).not.toHaveProperty('result')
    expect(assistant?.isToolStreaming).toBe(false)
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

  it('settles straggler running tools to success on final', async () => {
    mockReadSSEEvents.mockImplementation(async (_source, options) => {
      await options.onEvent({
        blockId: 'agent-1',
        event: 'tool',
        phase: 'start',
        id: 'toolu_open',
        name: 'http_request',
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

    expect(messages.find((m) => m.id === 'msg-assistant-1')?.toolCalls?.[0]?.status).toBe('success')
  })
})
