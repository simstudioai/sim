import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import type { AgentStreamEvent, AgentStreamFormat } from '@/providers/stream-events'
import type { TimeSegment } from '@/providers/types'

/**
 * Provider-agnostic assembly of the {@link StreamingExecution} object that every
 * LLM provider returns from its streaming path. Centralizes the start/end timing,
 * duration tracking, time-segment wiring, the `success`/`logs`/`metadata` envelope,
 * and the timing-finalization contract that was previously copy-pasted across
 * providers. Callers inject only the provider-specific stream iterable (which
 * writes final content/tokens/cost) via {@link CreateStreamingExecutionOptions.createStream}.
 */

/** Initial cost slice; shape is opaque so providers may include `toolCost`/`pricing`. */
type CostSlice = NonNullable<NormalizedBlockOutput['cost']>

/** Initial token slice written into `execution.output.tokens`. */
type TokenSlice = NonNullable<NormalizedBlockOutput['tokens']>

/**
 * Tool-call container written into `execution.output.toolCalls`. Providers build
 * structurally-compatible list items whose `result` field is `unknown`; the
 * container is widened here (mirroring the providers' former `as StreamingExecution`
 * cast) and narrowed on assignment.
 */
type ToolCallSlice = { list: unknown[]; count: number }

/**
 * Timing for the no-tools streaming path. The factory builds a single inline
 * `model` time segment and, when {@link StreamFinalizer.finalizeTiming} runs,
 * overwrites the top-level `endTime`/`duration` and that segment's
 * `endTime`/`duration` from the drain timestamp.
 */
interface SimpleTiming {
  kind: 'simple'
  /** Segment label — providers use the model id. */
  segmentName: string
}

/**
 * Timing for the post-tool streaming path. The factory emits the pre-built
 * segments and aggregate counters from the tool-execution loop and, when
 * {@link StreamFinalizer.finalizeTiming} runs, overwrites only the top-level
 * `endTime`/`duration` (segments are already finalized by the loop).
 */
interface AccumulatedTiming {
  kind: 'accumulated'
  modelTime: number
  toolsTime: number
  firstResponseTime: number
  iterations: number
  timeSegments: TimeSegment[]
}

type StreamingTiming = SimpleTiming | AccumulatedTiming

/** Handles passed to {@link CreateStreamingExecutionOptions.createStream}. */
interface StreamFinalizer {
  /** Live output object — write final `content`/`tokens`/`cost` here on drain. */
  output: NormalizedBlockOutput
  /** Overwrites placeholder timing from the drain timestamp. Call once on drain. */
  finalizeTiming: () => void
}

interface CreateStreamingExecutionOptions {
  /** Model id echoed into `execution.output.model`. */
  model: string
  /** Wall-clock ms when the provider started the request (`Date.now()`). */
  providerStartTime: number
  /** ISO form of {@link providerStartTime}. */
  providerStartTimeISO: string
  /** Timing shape — `simple` (no tools) or `accumulated` (post-tools). */
  timing: StreamingTiming
  /** Initial token counts (zeroed for the simple path, accumulated otherwise). */
  initialTokens: TokenSlice
  /** Initial cost (zeroed for the simple path, accumulated otherwise). */
  initialCost: CostSlice
  /** Tool-call container, or `undefined` when none were used. */
  toolCalls?: ToolCallSlice
  /** Marks `execution.isStreaming = true` when set. */
  isStreaming?: boolean
  /**
   * Declares whether {@link createStream} returns UTF-8 answer bytes (`text`)
   * or an in-process {@link AgentStreamEvent} object stream (`agent-events-v1`).
   * Defaults to `'text'` so existing providers stay unchanged.
   */
  streamFormat?: AgentStreamFormat
  /**
   * Builds the provider stream. Receives the live `output` object and a
   * `finalizeTiming` hook. The provider wires its native stream factory and, in
   * the drain callback, writes final content/tokens/cost onto `output` then
   * calls `finalizeTiming()`.
   */
  createStream: (
    handles: StreamFinalizer
  ) => ReadableStream<Uint8Array> | ReadableStream<AgentStreamEvent>
}

/**
 * Assembles a fully-wired {@link StreamingExecution}. The provider's stream
 * (from {@link CreateStreamingExecutionOptions.createStream}) populates the
 * output and finalizes timing on drain.
 */
export function createStreamingExecution(
  options: CreateStreamingExecutionOptions
): StreamingExecution {
  const {
    model,
    providerStartTime,
    providerStartTimeISO,
    timing,
    initialTokens,
    initialCost,
    toolCalls,
    isStreaming,
    streamFormat = 'text',
    createStream,
  } = options

  const now = Date.now()
  const nowISO = new Date(now).toISOString()
  const duration = now - providerStartTime

  const providerTiming: NonNullable<NormalizedBlockOutput['providerTiming']> =
    timing.kind === 'simple'
      ? {
          startTime: providerStartTimeISO,
          endTime: nowISO,
          duration,
          timeSegments: [
            {
              type: 'model',
              name: timing.segmentName,
              startTime: providerStartTime,
              endTime: now,
              duration,
            },
          ],
        }
      : {
          startTime: providerStartTimeISO,
          endTime: nowISO,
          duration,
          modelTime: timing.modelTime,
          toolsTime: timing.toolsTime,
          firstResponseTime: timing.firstResponseTime,
          iterations: timing.iterations,
          timeSegments: timing.timeSegments,
        }

  const output: NormalizedBlockOutput = {
    content: '',
    model,
    tokens: initialTokens,
    toolCalls: toolCalls as NormalizedBlockOutput['toolCalls'],
    providerTiming,
    cost: initialCost,
  }

  const timingKind = timing.kind
  const stream = createStream({
    output,
    finalizeTiming: () => finalizeTiming(output, providerStartTime, timingKind),
  })

  return {
    stream,
    streamFormat,
    execution: {
      success: true,
      output,
      logs: [],
      metadata: {
        startTime: providerStartTimeISO,
        endTime: nowISO,
        duration,
      },
      ...(isStreaming ? { isStreaming: true } : {}),
    },
  }
}

/**
 * Overwrites the placeholder timing with the drain timestamp. For the simple
 * path the first time segment is also finalized; for the accumulated path only
 * the top-level aggregate is touched (segments are pre-finalized by the loop).
 */
function finalizeTiming(
  output: NormalizedBlockOutput,
  providerStartTime: number,
  kind: StreamingTiming['kind']
): void {
  const streamEndTime = Date.now()
  const providerTiming = output.providerTiming
  if (!providerTiming) return

  providerTiming.endTime = new Date(streamEndTime).toISOString()
  providerTiming.duration = streamEndTime - providerStartTime

  if (kind === 'simple') {
    const segment = providerTiming.timeSegments?.[0]
    if (segment) {
      segment.endTime = streamEndTime
      segment.duration = streamEndTime - providerStartTime
    }
  }
}
