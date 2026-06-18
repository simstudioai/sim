import { classifyHostedKeyFailure } from '@/lib/api-key/hosted-cost'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { hostedKeyMetrics } from '@/lib/monitoring/metrics'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import type { TimeSegment } from '@/providers/types'
import { calculateCost } from '@/providers/utils'

/**
 * Passthrough of `source` that runs at most one terminal callback: `onDrain` when
 * it completes normally, or `onError` when a read errors mid-stream. A client
 * `cancel` runs neither (an abort is not a key failure).
 */
function tapStreamTermination(
  source: ReadableStream,
  callbacks: { onDrain?: () => void; onError?: (error: unknown) => void }
): ReadableStream {
  const reader = source.getReader()
  let finished = false
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          if (!finished) {
            finished = true
            callbacks.onDrain?.()
          }
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        if (!finished) {
          finished = true
          callbacks.onError?.(error)
        }
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/**
 * Wrap a hosted-key streaming response so a mid-stream read error records a
 * hosted-key failure metric. Applied provider-agnostically at the chokepoint
 * (`executeProviderRequest`) so it covers every provider — including ones that
 * build streams bespoke (gemini) and don't go through {@link createStreamingExecution}.
 * Cost on success is settled per-provider; this only handles the failure leg.
 */
export function recordHostedStreamFailure(
  source: ReadableStream,
  hostedKey: { provider: string; envVar: string },
  model: string
): ReadableStream {
  return tapStreamTermination(source, {
    onError: (error) =>
      hostedKeyMetrics.recordFailed({
        provider: hostedKey.provider,
        tool: model,
        key: hostedKey.envVar,
        reason: classifyHostedKeyFailure(error),
      }),
  })
}

/**
 * Settle the authoritative streaming LLM cost onto `output.cost` from its final
 * tokens (the single cost seam shared with the non-streaming path), and — on the
 * hosted-key path — emit the hosted-key cost metric. The cost multiplier is the
 * platform markup on hosted usage, so it is applied only when `hostedKey` is set;
 * off the hosted path this is behaviour-preserving (multiplier 1). Any `toolCost`
 * already on `output.cost` is preserved. Used here and by providers that build
 * streams bespoke (e.g. gemini).
 */
export function settleStreamingLlmCost(
  output: NormalizedBlockOutput,
  model: string,
  hostedKey: { provider: string; envVar: string } | undefined,
  cached: boolean,
  toolCost?: number
): void {
  // Multiplier (platform markup) and cached pricing apply only on the hosted-key
  // path; off it this stays behaviour-preserving (multiplier 1, no cached).
  const multiplier = hostedKey ? getCostMultiplier() : 1
  const breakdown = calculateCost(
    model,
    output.tokens?.input ?? 0,
    output.tokens?.output ?? 0,
    hostedKey ? cached : false,
    multiplier,
    multiplier
  )
  const tc = toolCost ?? output.cost?.toolCost
  output.cost = tc ? { ...breakdown, toolCost: tc, total: breakdown.total + tc } : breakdown
  if (hostedKey) {
    hostedKeyMetrics.recordCostCharged(breakdown.total, {
      provider: hostedKey.provider,
      tool: model,
    })
  }
}

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
   * Hosted-key cost settlement. Set only when the call resolved to a platform
   * hosted-key (flag-on, not BYOK, not user key). When present, the wrapper owns
   * the authoritative `output.cost` on drain via {@link settleStreamingLlmCost}
   * (recomputed with the cost multiplier) and emits the hosted-key cost metric.
   * Absent ⇒ provider's cost is left as-is.
   */
  hostedKey?: { provider: string; envVar: string }
  /** Whether cached input pricing applies (mirrors the non-streaming `useCachedInput`). */
  cached?: boolean
  /**
   * Builds the provider stream. Receives the live `output` object and a
   * `finalizeTiming` hook. The provider wires its native stream factory and, in
   * the drain callback, writes final content/tokens/cost onto `output` then
   * calls `finalizeTiming()`.
   */
  createStream: (handles: StreamFinalizer) => ReadableStream
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
    hostedKey,
    cached,
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
  const baseStream = createStream({
    output,
    finalizeTiming: () => finalizeTiming(output, providerStartTime, timingKind),
  })

  // Settle hosted-key cost on actual stream drain. This must NOT hang off the
  // provider's `finalizeTiming` call — the post-tool streaming paths
  // (`createStream: ({ output }) => …`) never invoke it — so instead we wrap the
  // returned stream and settle once the source completes (final tokens are set by
  // the provider's drain callback before the stream closes). Recomputes the
  // authoritative cost with the multiplier and emits the cost metric exactly once.
  // Failure on error is handled provider-agnostically in executeProviderRequest.
  const stream = hostedKey
    ? tapStreamTermination(baseStream, {
        onDrain: () => settleStreamingLlmCost(output, model, hostedKey, cached ?? false),
      })
    : baseStream

  return {
    stream,
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
