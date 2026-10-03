import {
  type AgentCliEngine,
  type AgentCliFlags,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/agent-cli/types'
import { normalizeName } from '@/executor/constants'

/**
 * `logs query <workflowId> --block <name>` — one value per run for one block's
 * field, across a workflow's run history. Replaces the loop agents otherwise
 * improvise (list runs, pull each trace, dig the same span path by hand —
 * a field audit found that exact loop hand-rolled with per-run sleeps to answer
 * "how often does this branch fire, and with what values"). The trace walk is
 * recursive so blocks inside loops and subworkflows are found, and the last
 * matching span per run wins so loop iterations settle on final state.
 */

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const TRACE_FETCH_CONCURRENCY = 5
const VALUE_MAX_CHARS = 600
const PATH_NOT_FOUND_NOTE = 'path not found on span'

/**
 * Keys that live on the span itself. A path whose head is anything else is read
 * relative to the block's output when it resolves to nothing at the span root —
 * `result.count` means `output.result.count`, which is where a block's fields live.
 * Without this every run answered `value: null` for a path that was merely one
 * segment short, indistinguishable from a block that produced nothing.
 */
const SPAN_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'input',
  'output',
  'status',
  'name',
  'type',
  'duration',
  'blockId',
  'children',
  'tokens',
  'cost',
  'executionOrder',
  'errorHandled',
  'tries',
  'id',
  'startTime',
  'endTime',
])

interface QueryTraceSpan {
  name?: string
  status?: string
  duration?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  children?: QueryTraceSpan[]
}

interface RunListItem {
  runId: string
  status?: string
  trigger?: string
  startedAt?: string
  durationMs?: number
}

interface ResolvedSpanPath {
  value: unknown
  /** The path that produced `value`: as given, or prefixed when the fallback applied. */
  path: string
  resolvedUnder?: 'output'
}

function collectSpansByName(
  spans: QueryTraceSpan[],
  normalizedBlockName: string,
  out: QueryTraceSpan[]
): void {
  for (const span of spans) {
    if (normalizeName(span.name ?? '') === normalizedBlockName) out.push(span)
    if (span.children?.length) collectSpansByName(span.children, normalizedBlockName, out)
  }
}

function resolveSpanPath(span: QueryTraceSpan, path: string): unknown {
  let current: unknown = span
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** The path as given first; under `output.` when the head is not a span-level key. */
function resolveSpanPathWithFallback(span: QueryTraceSpan, path: string): ResolvedSpanPath {
  const direct = resolveSpanPath(span, path)
  if (direct !== undefined) return { value: direct, path }
  const head = path.split('.')[0] ?? ''
  if (SPAN_LEVEL_KEYS.has(head)) return { value: undefined, path }
  const underOutput = `output.${path}`
  const value = resolveSpanPath(span, underOutput)
  if (value === undefined) return { value: undefined, path }
  return { value, path: underOutput, resolvedUnder: 'output' }
}

function clipValue(value: unknown): unknown {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined || serialized.length <= VALUE_MAX_CHARS) return value
  return `${serialized.slice(0, VALUE_MAX_CHARS)}… [${serialized.length} chars total]`
}

function stringFlag(flags: AgentCliFlags, name: string): string | undefined {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

export const logsQueryCommand: AgentCliEngine = {
  async execute(rest: string[], runtime: AgentCliRuntime, flags: AgentCliFlags) {
    const workflowId = rest[0]
    const blockName = stringFlag(flags, 'block') ?? ''
    if (!workflowId || !blockName) {
      return agentCliFail(
        'Usage: sim logs query <workflowId> --block <name> [--field <path>] [--where <path>=<value>] [--status <s>] [--trigger <t>] [--limit N]\n' +
          'Paths resolve inside the matched block span: output.content, input.action_id, status, duration. ' +
          'A path that names no span-level key is read under output. (result.count means output.result.count).'
      )
    }
    const field = stringFlag(flags, 'field') ?? 'output'
    const where = stringFlag(flags, 'where') ?? ''
    const whereEquals = where.indexOf('=')
    if (where && whereEquals <= 0) {
      return agentCliFail('--where takes <path>=<value>, e.g. --where output.route=priority')
    }
    const wherePath = where ? where.slice(0, whereEquals) : ''
    const whereValue = where ? where.slice(whereEquals + 1) : ''
    const rawLimit = stringFlag(flags, 'limit')
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, rawLimit !== undefined ? Number(rawLimit) || DEFAULT_LIMIT : DEFAULT_LIMIT)
    )

    const listQuery: Record<string, string> = { limit: String(limit) }
    const status = stringFlag(flags, 'status')
    if (status !== undefined) listQuery.status = status
    const trigger = stringFlag(flags, 'trigger')
    if (trigger !== undefined) listQuery.trigger = trigger

    const runs = await runtime.client.request<{ data: RunListItem[] }>(
      `/api/v2/workflows/${encodeURIComponent(workflowId)}/runs`,
      { query: listQuery }
    )
    const runItems = runs.data ?? []
    const normalizedBlockName = normalizeName(blockName)

    const rows: (Record<string, unknown> | undefined)[] = new Array(runItems.length)
    let filteredOut = 0
    let missingTrace = 0
    let fieldResolvedUnder: 'output' | undefined
    let whereResolvedUnder: 'output' | undefined
    for (let start = 0; start < runItems.length; start += TRACE_FETCH_CONCURRENCY) {
      const chunk = runItems.slice(start, start + TRACE_FETCH_CONCURRENCY)
      await Promise.all(
        chunk.map(async (run, offset) => {
          const base = {
            runId: run.runId,
            startedAt: run.startedAt,
            runStatus: run.status,
          }
          let spans: QueryTraceSpan[]
          try {
            const trace = await runtime.client.request<{
              data: { traceSpans?: QueryTraceSpan[] }
            }>(`/api/v2/logs/${encodeURIComponent(run.runId)}`)
            spans = trace.data.traceSpans ?? []
          } catch {
            missingTrace++
            rows[start + offset] = { ...base, note: 'trace unavailable' }
            return
          }
          const matches: QueryTraceSpan[] = []
          collectSpansByName(spans, normalizedBlockName, matches)
          const last = matches[matches.length - 1]
          if (!last) {
            // Under --where a run the block never reached cannot match; returning it as
            // `hits: 0` made matches indistinguishable from padding.
            if (wherePath) {
              filteredOut++
              return
            }
            rows[start + offset] = { ...base, hits: 0, value: null }
            return
          }
          if (wherePath) {
            const matched = resolveSpanPathWithFallback(last, wherePath)
            if (matched.resolvedUnder) whereResolvedUnder = matched.resolvedUnder
            if (String(matched.value) !== whereValue) {
              filteredOut++
              return
            }
          }
          const resolved = resolveSpanPathWithFallback(last, field)
          if (resolved.resolvedUnder) fieldResolvedUnder = resolved.resolvedUnder
          rows[start + offset] = {
            ...base,
            hits: matches.length,
            blockStatus: last.status ?? 'success',
            value: clipValue(resolved.value),
            ...(resolved.value === undefined ? { note: PATH_NOT_FOUND_NOTE } : {}),
          }
        })
      )
    }

    const kept = rows.filter((row): row is Record<string, unknown> => row !== undefined)
    return agentCliOk(
      JSON.stringify(
        {
          workflowId,
          block: blockName,
          field: fieldResolvedUnder ? `output.${field}` : field,
          ...(fieldResolvedUnder ? { fieldResolvedUnder } : {}),
          runsScanned: runItems.length,
          ...(wherePath
            ? {
                where: whereResolvedUnder ? `output.${where}` : where,
                ...(whereResolvedUnder ? { whereResolvedUnder } : {}),
                filteredOut,
              }
            : {}),
          ...(missingTrace ? { missingTrace } : {}),
          rows: kept,
        },
        null,
        2
      )
    )
  },
}
