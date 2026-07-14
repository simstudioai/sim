/**
 * Executor-facing agent stream pump (Step 2).
 *
 * Owns a single drain of a provider {@link StreamingExecution} source and:
 * - projects final-turn answer text to an optional legacy byte stream
 * - pushes the full ordered timeline (including text) to optional sinks
 * - awaits each sink per event (simple backpressure; SSE enqueues are cheap)
 *
 * Wired into {@link BlockExecutor} `handleStreamingExecution` (Step 3).
 */

import {
  type AgentStreamEvent,
  type AgentStreamFormat,
  type AgentStreamSink,
  type UnsubscribeAgentStreamSink,
  isAgentStreamEvent,
} from '@/providers/stream-events'

/** Default cap on thinking text forwarded to sinks (UTF-16 code units via `.length`). */
export const DEFAULT_MAX_THINKING_BYTES = 512 * 1024

export type AgentStreamPumpCancelReason = 'user' | 'timeout' | 'unknown'

export interface CreateAgentStreamPumpOptions {
  source: ReadableStream<unknown>
  streamFormat: AgentStreamFormat
  /**
   * When true, no legacy text {@link ReadableStream} is created — upgraded
   * consumers read only the sink. Avoids unbounded buffering into an unread stream.
   */
  sinkMode?: boolean
  maxThinkingBytes?: number
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
  if (reason && typeof reason === 'object' && 'name' in reason) {
    const name = String((reason as { name?: unknown }).name)
    if (name === 'TimeoutError') return 'timeout'
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
    maxThinkingBytes = DEFAULT_MAX_THINKING_BYTES,
    abortSignal,
  } = options

  const sinks = new Map<AgentStreamSink, SinkState>()
  let started = false
  let closedTextStream = false

  let answerText = ''
  let thinkingBytesForwarded = 0

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
      const remaining = Math.max(0, maxThinkingBytes - thinkingBytesForwarded)
      if (remaining <= 0) return
      const forwarded =
        event.text.length > remaining ? event.text.slice(0, remaining) : event.text
      thinkingBytesForwarded += forwarded.length
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

    // Synthesize tool ends — enqueue-then-error in provider loops can drop
    // settlement frames (WHATWG resets the queue on error).
    if (cancelled) {
      await settleOpenTools('cancelled')
    } else if (drainError) {
      await settleOpenTools('error')
    }

    if (drainError) {
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
 */
export function projectStreamingExecutionToByteStream(streamingExec: {
  stream: ReadableStream<unknown>
  streamFormat?: AgentStreamFormat
}): ReadableStream<Uint8Array> {
  const streamFormat = streamingExec.streamFormat ?? 'text'
  if (streamFormat === 'text') {
    return streamingExec.stream as ReadableStream<Uint8Array>
  }

  const pump = createAgentStreamPump({
    source: streamingExec.stream,
    streamFormat,
  })
  const textStream = pump.textStream
  if (!textStream) {
    throw new Error('Agent stream pump expected a text projection stream')
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const runPromise = pump.run()
      const reader = textStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
        await runPromise
        controller.close()
      } catch (error) {
        try {
          controller.error(error instanceof Error ? error : new Error(String(error)))
        } catch {
          // already closed/errored
        }
      }
    },
    cancel(reason) {
      void textStream.cancel(reason)
    },
  })
}
