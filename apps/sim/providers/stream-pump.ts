/**
 * Executor-facing agent stream pump.
 *
 * Owns a single drain of a provider {@link StreamingExecution} source and:
 * - projects final-turn answer text to an optional legacy byte stream
 * - pushes the full ordered timeline (including text deltas, which current
 *   sinks ignore — answer text reaches clients via the byte projection) to
 *   optional sinks
 * - awaits each sink per event (simple backpressure; SSE enqueues are cheap)
 *
 * Wired into {@link BlockExecutor} `handleStreamingExecution`.
 */

import {
  type AgentStreamEvent,
  type AgentStreamFormat,
  type AgentStreamSink,
  isAgentStreamEvent,
  type UnsubscribeAgentStreamSink,
} from '@/providers/stream-events'

/**
 * Default cap on thinking text forwarded to sinks, in UTF-16 code units.
 * Enforced twice on purpose, at different scopes: the pump caps per block
 * (each agent block gets its own pump) while the chat SSE `sendThinking` caps
 * per execution so a many-block workflow cannot flood a public stream.
 */
export const DEFAULT_MAX_THINKING_CHARS = 512 * 1024

export type AgentStreamPumpCancelReason = 'user' | 'timeout' | 'unknown'

export interface CreateAgentStreamPumpOptions {
  source: ReadableStream<unknown>
  streamFormat: AgentStreamFormat
  /**
   * When true, no legacy text {@link ReadableStream} is created — upgraded
   * consumers read only the sink. Avoids unbounded buffering into an unread stream.
   */
  sinkMode?: boolean
  maxThinkingChars?: number
  abortSignal?: AbortSignal
}

export interface AgentStreamPumpResult {
  /** Final-turn answer text only (`turn: 'intermediate'` excluded). */
  answerText: string
  fullyDrained: boolean
  cancelled: boolean
  cancelReason?: AgentStreamPumpCancelReason
}

export interface AgentStreamPump {
  subscribe: (sink: AgentStreamSink) => UnsubscribeAgentStreamSink
  /** Final-turn answer bytes, or `null` when {@link CreateAgentStreamPumpOptions.sinkMode}. */
  readonly textStream: ReadableStream<Uint8Array> | null
  /**
   * Starts draining the provider source. Call only after the synchronous
   * subscribe window (e.g. after `onStream` returns).
   */
  run: () => Promise<AgentStreamPumpResult>
}

interface SinkState {
  sink: AgentStreamSink
  detached: boolean
}

function resolveCancelReason(signal: AbortSignal): AgentStreamPumpCancelReason {
  const reason = signal.reason
  if (reason === 'timeout' || reason === 'user') {
    return reason
  }
  if (typeof reason === 'string') {
    const lower = reason.toLowerCase()
    if (lower.includes('timeout')) return 'timeout'
    if (lower.includes('abort') || lower.includes('cancel') || lower.includes('user')) {
      return 'user'
    }
  }
  if (reason && typeof reason === 'object') {
    // Execution aborts carry DOMException('timeout' | 'user', 'AbortError').
    const { name, message } = reason as { name?: unknown; message?: unknown }
    if (message === 'timeout' || String(name) === 'TimeoutError') return 'timeout'
    if (message === 'user') return 'user'
  }
  return 'unknown'
}

function isFinalTurnText(event: Extract<AgentStreamEvent, { type: 'text_delta' }>): boolean {
  return event.turn !== 'intermediate'
}

/**
 * Creates a pump over a provider stream. Subscribe synchronously before {@link AgentStreamPump.run}.
 */
export function createAgentStreamPump(options: CreateAgentStreamPumpOptions): AgentStreamPump {
  const {
    source,
    streamFormat,
    sinkMode = false,
    maxThinkingChars = DEFAULT_MAX_THINKING_CHARS,
    abortSignal,
  } = options

  const sinks = new Map<AgentStreamSink, SinkState>()
  let started = false
  let closedTextStream = false

  let answerText = ''
  let thinkingCharsForwarded = 0

  let textController: ReadableStreamDefaultController<Uint8Array> | null = null
  let textBackpressureWait: Promise<void> | null = null
  let resolveTextBackpressure: (() => void) | null = null
  const textEncoder = new TextEncoder()

  const textStream = sinkMode
    ? null
    : new ReadableStream<Uint8Array>({
        start(controller) {
          textController = controller
        },
        pull() {
          if (resolveTextBackpressure) {
            const resolve = resolveTextBackpressure
            resolveTextBackpressure = null
            textBackpressureWait = null
            resolve()
          }
        },
        cancel() {
          closedTextStream = true
          textController = null
          if (resolveTextBackpressure) {
            const resolve = resolveTextBackpressure
            resolveTextBackpressure = null
            textBackpressureWait = null
            resolve()
          }
        },
      })

  function subscribe(sink: AgentStreamSink): UnsubscribeAgentStreamSink {
    if (sinks.has(sink)) {
      return () => {
        detachSink(sink)
      }
    }

    sinks.set(sink, { sink, detached: false })
    return () => detachSink(sink)
  }

  function detachSink(sink: AgentStreamSink): void {
    const state = sinks.get(sink)
    if (!state || state.detached) return
    state.detached = true
    sinks.delete(sink)
  }

  async function dispatchToSinks(event: AgentStreamEvent): Promise<void> {
    const active = [...sinks.values()].filter((s) => !s.detached)
    if (active.length === 0) return

    await Promise.all(
      active.map(async (state) => {
        if (state.detached) return
        try {
          await state.sink.onEvent(event)
        } catch {
          detachSink(state.sink)
        }
      })
    )
  }

  async function enqueueAnswerText(text: string): Promise<void> {
    if (!text) return

    answerText += text

    if (sinkMode || closedTextStream || !textController) return

    const chunk = textEncoder.encode(text)

    while (!closedTextStream && textController) {
      const desired = textController.desiredSize
      if (desired === null) return
      if (desired > 0) {
        try {
          textController.enqueue(chunk)
        } catch {
          closedTextStream = true
          textController = null
        }
        return
      }
      if (!textBackpressureWait) {
        textBackpressureWait = new Promise<void>((resolve) => {
          resolveTextBackpressure = resolve
        })
      }
      await textBackpressureWait
    }
  }

  function closeTextStream(error?: unknown): void {
    if (sinkMode || closedTextStream) return
    closedTextStream = true
    try {
      if (error !== undefined && textController) {
        textController.error(error)
      } else {
        textController?.close()
      }
    } catch {
      // already closed
    }
    textController = null
    if (resolveTextBackpressure) {
      resolveTextBackpressure()
      resolveTextBackpressure = null
      textBackpressureWait = null
    }
  }

  /** Open tool_call_start ids → names; settled on abort/error so sinks never hang. */
  const openTools = new Map<string, string>()

  async function settleOpenTools(status: 'cancelled' | 'error'): Promise<void> {
    if (openTools.size === 0) return
    const pending = [...openTools.entries()]
    openTools.clear()
    for (const [id, name] of pending) {
      await dispatchToSinks({ type: 'tool_call_end', id, name, status })
    }
  }

  async function handleEvent(event: AgentStreamEvent): Promise<void> {
    if (event.type === 'thinking_delta') {
      const remaining = Math.max(0, maxThinkingChars - thinkingCharsForwarded)
      if (remaining <= 0) return
      const forwarded = event.text.length > remaining ? event.text.slice(0, remaining) : event.text
      thinkingCharsForwarded += forwarded.length
      if (forwarded.length > 0) {
        await dispatchToSinks({ type: 'thinking_delta', text: forwarded })
      }
      return
    }

    if (event.type === 'text_delta') {
      await dispatchToSinks(event)
      if (isFinalTurnText(event)) {
        await enqueueAnswerText(event.text)
      }
      return
    }

    if (event.type === 'tool_call_start') {
      openTools.set(event.id, event.name)
      await dispatchToSinks(event)
      return
    }

    if (event.type === 'tool_call_end') {
      openTools.delete(event.id)
      await dispatchToSinks(event)
      return
    }

    await dispatchToSinks(event)
  }

  async function run(): Promise<AgentStreamPumpResult> {
    if (started) {
      throw new Error('Agent stream pump already started')
    }
    started = true

    let cancelled = false
    let cancelReason: AgentStreamPumpCancelReason | undefined
    let fullyDrained = false
    let drainError: unknown

    const reader = source.getReader()
    const decoder = new TextDecoder()

    const onAbort = () => {
      cancelled = true
      if (abortSignal) {
        cancelReason = resolveCancelReason(abortSignal)
      } else {
        cancelReason = 'unknown'
      }
      void reader.cancel(abortSignal?.reason ?? 'aborted')
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    try {
      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done) {
          if (streamFormat === 'text') {
            const tail = decoder.decode()
            if (tail) {
              await handleEvent({ type: 'text_delta', text: tail, turn: 'final' })
            }
          }
          fullyDrained = true
          break
        }

        if (streamFormat === 'text') {
          if (!(value instanceof Uint8Array)) {
            throw new Error('text streamFormat expected Uint8Array chunks')
          }
          const text = decoder.decode(value, { stream: true })
          if (text) {
            await handleEvent({ type: 'text_delta', text, turn: 'final' })
          }
          continue
        }

        if (!isAgentStreamEvent(value)) {
          throw new Error('Invalid AgentStreamEvent on agent-events-v1 stream')
        }
        await handleEvent(value)
      }
    } catch (error) {
      drainError = error
    } finally {
      abortSignal?.removeEventListener('abort', onAbort)
      try {
        reader.releaseLock()
      } catch {
        // ignore
      }
    }

    // reader.cancel() / aborted read often surfaces as AbortError. That is the
    // cancel path, not a hard drain failure — keep accumulated answerText.
    const isAbortError =
      (drainError instanceof DOMException && drainError.name === 'AbortError') ||
      (drainError instanceof Error && drainError.name === 'AbortError')
    if (!cancelled && isAbortError && abortSignal?.aborted) {
      cancelled = true
      cancelReason = resolveCancelReason(abortSignal)
    }

    // Synthesize tool ends — enqueue-then-error in provider loops can drop
    // settlement frames (WHATWG resets the queue on error).
    if (cancelled) {
      await settleOpenTools('cancelled')
    } else if (drainError) {
      await settleOpenTools('error')
    }

    if (drainError && !cancelled) {
      closeTextStream(drainError)
      throw drainError instanceof Error ? drainError : new Error(String(drainError))
    }

    if (cancelled) {
      closeTextStream()
      return {
        answerText,
        fullyDrained: false,
        cancelled: true,
        cancelReason: cancelReason ?? 'unknown',
      }
    }

    closeTextStream()
    return {
      answerText,
      fullyDrained,
      cancelled: false,
    }
  }

  return {
    subscribe,
    textStream,
    run,
  }
}

/**
 * Project a {@link StreamingExecution} to a byte stream suitable for an HTTP
 * `Response` body. Agent-events object streams are pumped to final-turn answer
 * bytes; legacy `text` streams pass through unchanged.
 *
 * Cancelling the returned stream aborts the pump so provider work stops when
 * the HTTP client disconnects (billing/provider reads do not continue).
 */
export function projectStreamingExecutionToByteStream(streamingExec: {
  stream: ReadableStream<unknown>
  streamFormat?: AgentStreamFormat
}): ReadableStream<Uint8Array> {
  const streamFormat = streamingExec.streamFormat ?? 'text'
  if (streamFormat === 'text') {
    return streamingExec.stream as ReadableStream<Uint8Array>
  }

  const abortController = new AbortController()
  const pump = createAgentStreamPump({
    source: streamingExec.stream,
    streamFormat,
    abortSignal: abortController.signal,
  })
  const textStream = pump.textStream
  if (!textStream) {
    throw new Error('Agent stream pump expected a text projection stream')
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const runPromise = pump.run()
      reader = textStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
        await runPromise
        controller.close()
      } catch (error) {
        if (abortController.signal.aborted) {
          try {
            controller.close()
          } catch {
            // already closed/errored
          }
          return
        }
        try {
          controller.error(error instanceof Error ? error : new Error(String(error)))
        } catch {
          // already closed/errored
        }
      } finally {
        try {
          reader?.releaseLock()
        } catch {
          // ignore
        }
      }
    },
    cancel(reason) {
      abortController.abort(reason ?? 'user')
      void reader?.cancel(reason).catch(() => {})
      void textStream.cancel(reason).catch(() => {})
    },
  })
}
