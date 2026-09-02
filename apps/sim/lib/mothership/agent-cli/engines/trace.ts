import {
  type AgentCliEngine,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/agent-cli/types'

/**
 * `workflow trace <runId>` — a run's trace rolled up for diagnosis, replacing
 * the hand-written span filters agents otherwise improvise (a field audit found
 * four divergent jq programs over the same trace, two of which disagreed 7 vs
 * 21 blocks because a shallow walk silently drops every block inside a child
 * workflow). The walk here is always recursive, errors come only from status
 * and error FIELDS (never from schema literals that merely contain the word
 * "error"), and subworkflow spans keep their nesting depth visible.
 */

interface TraceSpan {
  id?: string
  name?: string
  type?: string
  duration?: number
  durationMs?: number
  status?: string
  errorHandled?: boolean
  errorType?: string
  errorMessage?: string
  blockId?: string
  children?: TraceSpan[]
}

interface FlatSpan {
  name: string
  type: string
  durationMs: number
  depth: number
  status?: string
  errorMessage?: string
  errorHandled?: boolean
}

function flattenSpans(spans: TraceSpan[], depth: number, out: FlatSpan[]): void {
  for (const span of spans) {
    out.push({
      name: span.name ?? span.blockId ?? 'unnamed',
      type: span.type ?? 'unknown',
      durationMs: span.durationMs ?? span.duration ?? 0,
      depth,
      ...(span.status !== undefined ? { status: span.status } : {}),
      ...(span.errorMessage !== undefined ? { errorMessage: span.errorMessage } : {}),
      ...(span.errorHandled !== undefined ? { errorHandled: span.errorHandled } : {}),
    })
    if (span.children?.length) flattenSpans(span.children, depth + 1, out)
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[index] ?? 0
}

export const workflowTraceCommand: AgentCliEngine = {
  async execute(rest, runtime: AgentCliRuntime) {
    const runId = rest[0]
    if (!runId) return agentCliFail('Usage: sim workflow trace <runId>')
    const run = await runtime.client.request<{
      data: {
        status?: string
        totalDurationMs?: number
        trigger?: string
        workflow?: { id?: string; name?: string }
        traceSpans?: TraceSpan[]
      }
    }>(`/api/v2/logs/${encodeURIComponent(runId)}`)
    const record = run.data
    const spans: FlatSpan[] = []
    flattenSpans(record.traceSpans ?? [], 0, spans)
    if (spans.length === 0) {
      return agentCliOk(
        JSON.stringify(
          {
            runId,
            status: record.status,
            workflow: record.workflow?.name,
            note: 'No trace spans (spans age out on their own retention schedule).',
          },
          null,
          2
        )
      )
    }

    const byType = new Map<string, number[]>()
    for (const span of spans) {
      const durations = byType.get(span.type) ?? []
      durations.push(span.durationMs)
      byType.set(span.type, durations)
    }
    const typeStats = [...byType.entries()]
      .map(([type, durations]) => {
        const sorted = [...durations].sort((a, b) => a - b)
        return {
          type,
          count: sorted.length,
          totalMs: sorted.reduce((a, b) => a + b, 0),
          p50Ms: percentile(sorted, 0.5),
          maxMs: sorted[sorted.length - 1] ?? 0,
        }
      })
      .sort((a, b) => b.totalMs - a.totalMs)

    const errors = spans
      .filter((span) => span.errorMessage || (span.status && /^(error|failed)$/i.test(span.status)))
      .map((span) => ({
        block: span.name,
        type: span.type,
        depth: span.depth,
        ...(span.status ? { status: span.status } : {}),
        ...(span.errorMessage ? { message: span.errorMessage.slice(0, 400) } : {}),
        ...(span.errorHandled !== undefined ? { handled: span.errorHandled } : {}),
      }))

    const slowest = [...spans]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10)
      .map((span) => ({
        block: span.name,
        type: span.type,
        durationMs: span.durationMs,
        depth: span.depth,
      }))

    return agentCliOk(
      JSON.stringify(
        {
          runId,
          workflow: record.workflow?.name,
          status: record.status,
          trigger: record.trigger,
          totalDurationMs: record.totalDurationMs,
          blockCount: spans.length,
          maxDepth: Math.max(...spans.map((span) => span.depth)),
          errors,
          typeStats,
          slowestBlocks: slowest,
        },
        null,
        2
      )
    )
  },
}
