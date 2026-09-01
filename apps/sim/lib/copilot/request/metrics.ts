// Sim server-side copilot metrics (U17). Sim's MeterProvider is wired in
// instrumentation-node.ts (OTLP → Mimir, 60s) but had no copilot instruments;
// this module is its first consumer. We emit the SAME metric names + label keys
// + histogram bucket boundaries as the Go side (copilot internal/telemetry +
// contracts/metrics_v1.go) so the Go∪Sim union is queryable as one series set
// — e.g. `copilot.tool.duration` split by `tool.executor` (go|client|sim).
//
// Bounded cardinality only: tool.name and gen_ai.agent.name are capped to the
// shared catalogs (else "other"); vfs phase / file-read outcome are bounded
// sets. NEVER a user/chat/request id (those explode Prometheus series).
import { type Counter, type Histogram, metrics } from '@opentelemetry/api'
import { Metric } from '@/lib/copilot/generated/metrics-v1'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'
import type { CopilotDegradedReasonValue } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'

// MUST match Go's copilot/internal/telemetry/metrics.go LatencyBucketsMs
// exactly — a histogram_quantile(sum by (le) …) over the Go∪Sim union is only
// valid with identical boundaries. If you change one side, change the other.
const LATENCY_BUCKETS_MS = [
  50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000,
]

// File sizes span KB→tens of MB; a bytes-appropriate bucket set (not latency).
const BYTE_BUCKETS = [1024, 8192, 65536, 262144, 1048576, 4194304, 16777216, 67108864, 268435456]

interface CopilotMeterInstruments {
  toolDuration: Histogram
  toolCalls: Counter
  degradedCount: Counter
  vfsMaterializeDuration: Histogram
  fileReadDuration: Histogram
  fileReadBytes: Histogram
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
    vfsMaterializeDuration: meter.createHistogram(Metric.CopilotVfsMaterializeDuration, {
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS_MS },
    }),
    fileReadDuration: meter.createHistogram(Metric.CopilotFileReadDuration, {
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS_MS },
    }),
    fileReadBytes: meter.createHistogram(Metric.CopilotFileReadSize, {
      unit: 'By',
      advice: { explicitBucketBoundaries: BYTE_BUCKETS },
    }),
  }
  return cached
}

// Caps tool.name to the shared catalog (matches Go's cappedToolName): a
// catalog tool keeps its name, everything else (user MCP/custom/unknown)
// collapses to "other" so series count stays finite.
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
    [TraceAttr.ToolExecutor]: 'sim',
    [TraceAttr.ToolOutcome]: outcome,
    [TraceAttr.GenAiAgentName]: normalizeToolAgentId(agentId),
  }
  toolCalls.add(1, attrs)
  if (durationMs >= 0) toolDuration.record(durationMs, attrs)
}

// recordDegraded counts one non-fatal fallback, labelled by the bounded reason
// it took. Every degradation path reports here so "are we degrading, and why" is
// one query instead of a per-incident investigation — and so a path that should
// be impossible can be alerted on at > 0. Sim's own logs do not reach Loki and
// the in-process TraceCollector is not exported, so without this a fallback is
// invisible.
export function recordDegraded(reason: CopilotDegradedReasonValue): void {
  instruments().degradedCount.add(1, {
    [TraceAttr.CopilotDegradedReason]: reason,
  })
}

// recordVfsMaterialize records VFS materialization time. Call once per phase
// with that phase's duration and once with phase="total" for the whole op, so
// the dashboard can show total + per-phase. phase must be a bounded value.
export function recordVfsMaterialize(phase: string, durationMs: number): void {
  if (durationMs < 0) return
  instruments().vfsMaterializeDuration.record(durationMs, {
    [TraceAttr.CopilotVfsPhase]: phase,
  })
}

// recordFileRead records server-side file-read duration + size by outcome.
export function recordFileRead(outcome: string, durationMs: number, bytes: number): void {
  const { fileReadDuration, fileReadBytes } = instruments()
  const attrs = { [TraceAttr.CopilotVfsReadOutcome]: outcome }
  if (durationMs >= 0) fileReadDuration.record(durationMs, attrs)
  if (bytes >= 0) fileReadBytes.record(bytes, attrs)
}
