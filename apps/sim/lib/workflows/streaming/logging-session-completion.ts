import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { ExecutionResult } from '@/executor/types'

/**
 * Finalizes the logging session a run deferred with `skipLoggingComplete`.
 *
 * A streamed run cannot close its log when the executor returns — the stream
 * still owes the client its terminal frame — so whichever stream owns the run
 * calls this once it has one. Clearing `_streamingMetadata` makes the call
 * idempotent.
 */
export async function completeLoggingSession(result: ExecutionResult): Promise<void> {
  if (!result._streamingMetadata?.loggingSession) {
    return
  }

  const { traceSpans, totalDuration } = buildTraceSpans(result)

  await result._streamingMetadata.loggingSession.safeComplete({
    endedAt: new Date().toISOString(),
    totalDurationMs: totalDuration || 0,
    finalOutput: result.output || {},
    traceSpans: traceSpans || [],
    workflowInput: result._streamingMetadata.processedInput,
  })

  result._streamingMetadata = undefined
}
