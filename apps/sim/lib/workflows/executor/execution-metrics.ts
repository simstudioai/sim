/**
 * Workflow execution OTel metrics — throughput counter + latency histogram.
 *
 * Wired into `createOTelSpansForWorkflowExecution` (the single funnel that all
 * four `LoggingSession.complete` paths call), so the counter fires exactly once
 * per completed execution.
 *
 * Bounded cardinality: only `workflow_id`, `trigger`, and `status` are label
 * dimensions. Never add `execution_id`, `workspace_id`, or `user_id` — those
 * explode Prometheus series.
 */
import { type Counter, type Histogram, metrics } from '@opentelemetry/api'

/** Matches `copilot/request/metrics.ts` latency buckets for histogram_quantile validity. */
const LATENCY_BUCKETS_MS = [
  50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000,
]

interface WorkflowMeterInstruments {
  executionCount: Counter
  executionDuration: Histogram
}

let cached: WorkflowMeterInstruments | undefined

/**
 * Lazy init: Turbopack/Next can evaluate this module before the NodeSDK
 * installs the real MeterProvider, so resolve instruments on first use (a
 * no-op meter before then simply drops records — same pattern as
 * `copilot/request/metrics.ts`).
 */
function instruments(): WorkflowMeterInstruments {
  if (cached) return cached
  const meter = metrics.getMeter('sim-workflow-executor')
  cached = {
    executionCount: meter.createCounter('workflow.execution.count'),
    executionDuration: meter.createHistogram('workflow.execution.duration', {
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS_MS },
    }),
  }
  return cached
}

/**
 * Record one completed workflow execution as a counter increment and latency
 * histogram sample. Called once per execution from the telemetry funnel.
 *
 * Never throws — inherits the caller's try/catch guard.
 */
export function recordWorkflowExecution(params: {
  workflowId: string
  trigger: string
  status: 'success' | 'error'
  durationMs: number
}): void {
  const { workflowId, trigger, status, durationMs } = params
  const { executionCount, executionDuration } = instruments()

  const attrs = {
    workflow_id: workflowId || 'unknown',
    trigger: trigger || 'unknown',
    status,
  }

  executionCount.add(1, attrs)
  executionDuration.record(durationMs, attrs)
}
