// Sim server-side copilot metrics. Sim's MeterProvider is wired in
// instrumentation-node.ts (OTLP → Mimir, 60s). Metric names come from
// observability/metric-names.ts; label keys and histogram buckets are Sim's,
// e.g. `copilot.tool.duration` split by `tool.executor`.
//
// Bounded cardinality only: tool.name and gen_ai.agent.name are capped to the
// shared catalogs (else "other"). NEVER a user/chat/request id (those explode
// Prometheus series).
import { type Counter, type Histogram, metrics } from '@opentelemetry/api'
import { TOOL_CATALOG } from '@/lib/mothership/generated/tool-catalog-v1'
import { Metric } from '@/lib/mothership/observability/metric-names'
import {
  type CopilotDegradedReasonValue,
  ToolExecutor,
} from '@/lib/mothership/observability/trace-attribute-values'
import { TraceAttr } from '@/lib/mothership/observability/trace-attributes'

// Changing these boundaries splits `histogram_quantile(sum by (le) …)` queries
// across the old and new series until the old ones age out.
const LATENCY_BUCKETS_MS = [
  50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000,
]

interface CopilotMeterInstruments {
  toolDuration: Histogram
  toolCalls: Counter
  degradedCount: Counter
}

let cached: CopilotMeterInstruments | undefined

// Lazy init: Turbopack/Next can evaluate this module before the NodeSDK
// installs the real MeterProvider, so resolve instruments on first use (a
// no-op meter before then simply drops records — same pattern as getCopilotTracer).
function instruments(): CopilotMeterInstruments {
  if (cached) return cached
  const meter = metrics.getMeter('sim-copilot')
  cached = {
    toolDuration: meter.createHistogram(Metric.CopilotToolDuration, {
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS_MS },
    }),
    toolCalls: meter.createCounter(Metric.CopilotToolCalls),
    degradedCount: meter.createCounter(Metric.CopilotDegradedCount),
  }
  return cached
}

// Caps tool.name to the shared catalog: a catalog tool keeps its name,
// everything else (user MCP/custom/unknown) collapses to "other" so series
// count stays finite.
function cappedToolName(name: string): string {
  return TOOL_CATALOG[name] ? name : 'other'
}

const REGISTERED_AGENT_IDS = new Set([
  'main',
  ...Object.values(TOOL_CATALOG).flatMap(({ subagentId }) => (subagentId ? [subagentId] : [])),
])

export function normalizeToolAgentId(agentId: string): string {
  return REGISTERED_AGENT_IDS.has(agentId) ? agentId : 'other'
}

// recordSimToolMetric emits copilot.tool.calls (+1) and copilot.tool.duration
// for one server-side Sim tool dispatch (executor=sim). outcome is the bounded
// tool outcome (success/error/…). Pure telemetry.
export function recordSimToolMetric(
  name: string,
  agentId: string,
  outcome: string,
  durationMs: number
): void {
  const { toolDuration, toolCalls } = instruments()
  const attrs = {
    [TraceAttr.ToolName]: cappedToolName(name),
    [TraceAttr.ToolExecutor]: ToolExecutor.Sim,
    [TraceAttr.ToolOutcome]: outcome,
    [TraceAttr.GenAiAgentName]: normalizeToolAgentId(agentId),
  }
  toolCalls.add(1, attrs)
  if (durationMs >= 0) toolDuration.record(durationMs, attrs)
}

// recordDegraded counts one non-fatal fallback, labelled by the bounded reason
// it took. Every degradation path reports here so "are we degrading, and why" is
// one query instead of a per-incident investigation — and so a path that should
// be impossible can be alerted on at > 0. Sim's own logs do not reach Loki, so
// without this a fallback is invisible.
export function recordDegraded(reason: CopilotDegradedReasonValue): void {
  instruments().degradedCount.add(1, {
    [TraceAttr.CopilotDegradedReason]: reason,
  })
}
