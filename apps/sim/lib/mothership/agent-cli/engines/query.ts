import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
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
 * The log projection withheld the content field this path reads through rather than
 * return what it could not prove safe to display, so the value says nothing about the run.
 */
const CONTENT_WITHHELD_NOTE = 'span content withheld by the log projection; value unknown'
const WHERE_WITHHELD_NOTE =
  'span content withheld by the log projection; --where could not be checked, run kept but not a confirmed match'

/**
 * Where the log projection can omit content on a span. It omits a content field whole
 * (never a key inside one), so a path is withheld only when it runs through one of these
 * fields and the field itself is absent on a span carrying `contentWithheld`; a present
 * field missing a nested key is a genuine miss. `#` matches an array index.
 */
const WITHHELD_CONTENT_PATHS: ReadonlyArray<readonly string[]> = [
  ['input'],
  ['output'],
  ['thinking'],
  ['errorMessage'],
  ['toolCalls', '#', 'input'],
  ['toolCalls', '#', 'output'],
  ['toolCalls', '#', 'error'],
  ['modelToolCalls', '#', 'arguments'],
  ['providerTiming', 'segments', '#', 'assistantContent'],
  ['providerTiming', 'segments', '#', 'thinkingContent'],
  ['providerTiming', 'segments', '#', 'errorMessage'],
  ['providerTiming', 'segments', '#', 'toolCalls', '#', 'arguments'],
]

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
  contentWithheld?: true
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
  /** Unresolved because the projection withheld the content field the path reads through. */
  withheld?: true
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

function isWithheldContentPrefix(segments: readonly string[]): boolean {
  return WITHHELD_CONTENT_PATHS.some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every((part, index) =>
        part === '#' ? /^\d+$/.test(segments[index] ?? '') : part === segments[index]
      )
  )
}

/** Whether an unresolved path stopped at a content field the projection omitted. */
function isWithheldPath(span: QueryTraceSpan, path: string): boolean {
  if (span.contentWithheld !== true) return false
  const segments = path.split('.')
  let current: unknown = span
  for (let index = 0; index < segments.length; index++) {
    if (current == null || typeof current !== 'object') return false
    const next = (current as Record<string, unknown>)[segments[index] ?? '']
    if (next === undefined) return isWithheldContentPrefix(segments.slice(0, index + 1))
    current = next
  }
  return false
}

/**
 * The path as given first; under `output.` when the head is not a span-level key. A
 * direct path through a withheld content field (`thinking`) stays unknown rather than
 * falling back to a same-named key under output.
 */
function resolveSpanPathWithFallback(span: QueryTraceSpan, path: string): ResolvedSpanPath {
  const direct = resolveSpanPath(span, path)
  if (direct !== undefined) return { value: direct, path }
  if (isWithheldPath(span, path)) return { value: undefined, path, withheld: true }
  const head = path.split('.')[0] ?? ''
  if (SPAN_LEVEL_KEYS.has(head)) return { value: undefined, path }
  const underOutput = `output.${path}`
  const value = resolveSpanPath(span, underOutput)
  if (value !== undefined) return { value, path: underOutput, resolvedUnder: 'output' }
  return isWithheldPath(span, underOutput)
    ? { value: undefined, path, withheld: true }
    : { value: undefined, path }
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
          'A path that names no span-level key is read under output. (result.count means output.result.count).\n' +
          'When the log projection withheld a content field (input, output, thinking, errorMessage, tool-call or provider-segment content), ' +
          'a path through it reports "value unknown" and, under --where, the run is kept with whereUnchecked: true (counted in whereUnchecked, not a confirmed match). ' +
          'A path missing inside a field that is present is "path not found" and fails --where.'
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

    let filteredOut = 0
    let missingTrace = 0
    let contentWithheld = 0
    let whereUnchecked = 0
    let fieldResolvedUnder: 'output' | undefined
    let whereResolvedUnder: 'output' | undefined
    const rows = await mapWithConcurrency(
      runItems,
      TRACE_FETCH_CONCURRENCY,
      async (run): Promise<Record<string, unknown> | undefined> => {
        const base = {
          runId: run.runId,
          startedAt: run.startedAt,
          runStatus: run.status,
        }
        let spans: QueryTraceSpan[]
        try {
          const trace = await runtime.client.request<{
            data: { traceSpans?: QueryTraceSpan[] }
          }>(`/api/v2/logs/${encodeURIComponent(run.runId)}`, {
            query: { includeWorkflowState: 'false' },
          })
          spans = trace.data.traceSpans ?? []
        } catch {
          missingTrace++
          return { ...base, note: 'trace unavailable' }
        }
        const matches: QueryTraceSpan[] = []
        collectSpansByName(spans, normalizedBlockName, matches)
        const last = matches[matches.length - 1]
        if (!last) {
          // Under --where a run the block never reached cannot match; returning it as
          // `hits: 0` made matches indistinguishable from padding.
          if (wherePath) {
            filteredOut++
            return undefined
          }
          return { ...base, hits: 0, value: null }
        }
        const matchedRow = {
          ...base,
          hits: matches.length,
          blockStatus: last.status ?? 'success',
        }
        let whereWithheld = false
        if (wherePath) {
          const matched = resolveSpanPathWithFallback(last, wherePath)
          if (matched.resolvedUnder) whereResolvedUnder = matched.resolvedUnder
          // Filtering on a withheld value would silently drop a run that may well match.
          whereWithheld = matched.withheld === true
          if (!whereWithheld && String(matched.value) !== whereValue) {
            filteredOut++
            return undefined
          }
        }
        const resolved = resolveSpanPathWithFallback(last, field)
        if (resolved.resolvedUnder) fieldResolvedUnder = resolved.resolvedUnder
        const fieldWithheld = resolved.withheld === true
        if (fieldWithheld) contentWithheld++
        if (whereWithheld) whereUnchecked++
        const note = fieldWithheld
          ? CONTENT_WITHHELD_NOTE
          : resolved.value === undefined
            ? PATH_NOT_FOUND_NOTE
            : whereWithheld
              ? WHERE_WITHHELD_NOTE
              : undefined
        return {
          ...matchedRow,
          value: clipValue(resolved.value),
          ...(note ? { note } : {}),
          ...(whereWithheld ? { whereUnchecked: true } : {}),
        }
      }
    )

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
                ...(whereUnchecked ? { whereUnchecked } : {}),
              }
            : {}),
          ...(missingTrace ? { missingTrace } : {}),
          ...(contentWithheld ? { contentWithheld } : {}),
          rows: kept,
        },
        null,
        2
      )
    )
  },
}
