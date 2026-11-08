import { hasUnhandledError, normalizeToolId, type TraceSpan } from '@/platform/lib/data/tables'

export interface FlatSpanEntry {
  span: TraceSpan
  depth: number
  parentIds: string[]
  parentDuration?: number
}

/** A span's stable id, made up when the trace lacks one. */
export function getSpanId(span: TraceSpan): string {
  return span.id || `span-${span.name}-${span.startTime}`
}

export function parseTime(value?: string | number | null): number {
  if (!value) return 0
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

export function spanDuration(span: TraceSpan): number {
  return span.duration || parseTime(span.endTime) - parseTime(span.startTime)
}

export function isIterationType(type: string): boolean {
  const lower = type?.toLowerCase() || ''
  return lower === 'loop-iteration' || lower === 'parallel-iteration'
}

function hasErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error') return true
  if (span.children?.length) return span.children.some(hasErrorInTree)
  if (span.toolCalls?.length) return span.toolCalls.some((call) => call.error)
  return false
}

/** Whether a span failed: a root workflow only for an error nothing handled. */
export function spanFailed(span: TraceSpan, depth: number): boolean {
  return depth === 0 && span.type?.toLowerCase() === 'workflow'
    ? hasUnhandledError(span, { includeToolCalls: true })
    : hasErrorInTree(span)
}

/**
 * The bare tool name of an MCP tool id, `mcp-{serverId}-{toolName}`, or null for another id. Kept
 * here, as the legacy trace keeps it, since the MCP utilities reach server code.
 */
export function mcpToolName(toolId: string): string | null {
  if (!toolId.startsWith('mcp-')) return null
  const parts = toolId.split('-')
  if (parts.length < 3) return null
  const name = parts.slice(2).join('-')
  return name.length > 0 ? name : null
}

export function getDisplayName(span: TraceSpan): string {
  if (span.type?.toLowerCase() === 'tool')
    return mcpToolName(span.name) ?? normalizeToolId(span.name)
  return span.name
}

/** Spans sorted by start (then end) time at every level. */
export function normalizeAndSort(spans: TraceSpan[]): TraceSpan[] {
  return spans
    .map((span) => ({
      ...span,
      children: span.children?.length ? normalizeAndSort(span.children) : undefined,
    }))
    .sort((a, b) => {
      const byStart = parseTime(a.startTime) - parseTime(b.startTime)
      return byStart !== 0 ? byStart : parseTime(a.endTime) - parseTime(b.endTime)
    })
}

/**
 * A span's children as the tree shows them: legacy tool calls become tool spans, and an agent that
 * called no tool hides its synthetic model segments.
 */
export function getDisplayChildren(span: TraceSpan): TraceSpan[] {
  const kids: TraceSpan[] = span.children?.length
    ? [...span.children]
    : (span.toolCalls ?? []).map((call, index) => ({
        id: `${getSpanId(span)}-tool-${index}`,
        name: call.name,
        type: 'tool',
        duration: call.duration || 0,
        startTime: call.startTime ?? span.startTime,
        endTime: call.endTime ?? span.endTime,
        status: call.error ? ('error' as const) : ('success' as const),
        input: call.input,
        output: call.error ? { error: call.error, ...(call.output ?? {}) } : call.output,
      }))
  kids.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime))
  const isAgent = span.type?.toLowerCase() === 'agent'
  const calledTool = kids.some((child) => child.type?.toLowerCase() === 'tool')
  if (isAgent && !calledTool) return kids.filter((child) => child.type?.toLowerCase() !== 'model')
  return kids
}

/** The open part of the tree as a list, with each row's depth, ancestors and parent duration. */
export function flattenVisible(spans: TraceSpan[], expanded: ReadonlySet<string>): FlatSpanEntry[] {
  const out: FlatSpanEntry[] = []
  const walk = (
    list: TraceSpan[],
    depth: number,
    parents: string[],
    parentDuration: number | undefined
  ) => {
    for (const span of list) {
      const id = getSpanId(span)
      out.push({ span, depth, parentIds: parents, parentDuration })
      const children = getDisplayChildren(span)
      if (children.length > 0 && expanded.has(id)) {
        walk(children, depth + 1, [...parents, id], spanDuration(span))
      }
    }
  }
  walk(spans, 0, [], undefined)
  return out
}

export function collectAllIds(spans: TraceSpan[]): string[] {
  const out: string[] = []
  const walk = (list: TraceSpan[]) => {
    for (const span of list) {
      out.push(getSpanId(span))
      const children = getDisplayChildren(span)
      if (children.length > 0) walk(children)
    }
  }
  walk(spans)
  return out
}

/** The deepest failed span: where the error came from, not a parent it propagated to. */
export function findLeafErrorSpan(spans: TraceSpan[]): TraceSpan | null {
  for (const span of spans) {
    const children = getDisplayChildren(span)
    if (span.status === 'error') return findLeafErrorSpan(children) ?? span
    if (children.length > 0) {
      const found = findLeafErrorSpan(children)
      if (found) return found
    }
  }
  return null
}

export function findSpan(spans: TraceSpan[], id: string | null): TraceSpan | null {
  if (!id) return null
  for (const span of spans) {
    if (getSpanId(span) === id) return span
    const children = getDisplayChildren(span)
    if (children.length > 0) {
      const found = findSpan(children, id)
      if (found) return found
    }
  }
  return null
}

export function spanMatchesQuery(span: TraceSpan, query: string): boolean {
  if (!query) return true
  return getDisplayName(span).toLowerCase().includes(query.toLowerCase())
}

/** Spans that match the filter or hold a match, so a match keeps its ancestors. */
export function collectMatchingIds(spans: TraceSpan[], query: string): Set<string> {
  const matches = new Set<string>()
  const walk = (list: TraceSpan[]): boolean => {
    let any = false
    for (const span of list) {
      const children = getDisplayChildren(span)
      const childMatch = children.length > 0 ? walk(children) : false
      if (spanMatchesQuery(span, query) || childMatch) {
        matches.add(getSpanId(span))
        any = true
      }
    }
    return any
  }
  walk(spans)
  return matches
}

export function formatTokenCount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value.toLocaleString('en-US')
}

export function formatTtft(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatTps(
  outputTokens: number | undefined,
  durationMs: number
): string | undefined {
  if (typeof outputTokens !== 'number' || !(outputTokens > 0)) return undefined
  if (!(durationMs > 0)) return undefined
  const tps = Math.round(outputTokens / (durationMs / 1000))
  return tps > 0 ? `${tps.toLocaleString('en-US')} tok/s` : undefined
}
