import { compileLinearRegex, isPlainText, literalRegex } from '@/lib/core/security/linear-regex'
import {
  materializeLargeArrayManifest,
  readLargeArrayManifestSlice,
} from '@/lib/execution/payloads/large-array-manifest'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import type { TraceSpan } from '@/lib/logs/types'

/**
 * Access/materialization context for resolving large-value refs embedded in a
 * trace. Built once per request (by the caller) from the fetched execution log.
 */
export type LogViewContext = LargeValueStoreContext

/** Cap a single (non-array) large-value ref materialization. */
const SINGLE_REF_MAX_BYTES = 4 * 1024 * 1024
/** Items per large-array slice while streaming a grep. */
const ARRAY_SLICE_BATCH = 200

const DEFAULT_MAX_MATCHES = 50
const DEFAULT_MAX_SNIPPET_CHARS = 500
const DEFAULT_MAX_SLICES_SCANNED = 200

/**
 * Cumulative time the pattern itself may spend matching, across all spans/fields.
 *
 * Deliberately counts only time spent matching, not the grep's wall clock: the
 * scan awaits blob-store reads (array slices, large-value refs) between matches,
 * and charging that I/O to the budget would truncate slow-but-legitimate greps
 * under load. Matching is the only part that occupies the event loop, so it is
 * the only part worth bounding.
 *
 * RE2JS trades throughput for its linear-time guarantee — roughly 100x slower
 * than the built-in engine, ~25ms per megabyte — so on a very large trace this
 * budget is what actually caps the scan rather than a formality.
 */
const DEFAULT_MATCH_TIME_BUDGET_MS = 5_000
/**
 * Total characters a single grep may run the pattern over. Bounds the work one
 * request can demand across every span and slice; set well above any realistic
 * trace so normal greps never trip it.
 */
const DEFAULT_MAX_SCANNED_CHARS = 64 * 1024 * 1024

// ---------------------------------------------------------------------------
// Overview (Level 2): block tree with timing + cost, NO input/output.
// ---------------------------------------------------------------------------

export interface OverviewSpan {
  id: string
  blockId?: string
  name: string
  type: string
  status?: string
  durationMs: number
  cost?: TraceSpan['cost']
  children?: OverviewSpan[]
}

/** Project trace spans to a compact overview tree. Never materializes refs. */
export function toOverview(spans: TraceSpan[]): OverviewSpan[] {
  return spans.map((s) => {
    const node: OverviewSpan = {
      id: s.id,
      blockId: s.blockId,
      name: s.name,
      type: s.type,
      status: s.status,
      durationMs: s.duration ?? 0,
    }
    if (s.cost) node.cost = s.cost
    if (s.children && s.children.length > 0) node.children = toOverview(s.children)
    return node
  })
}

// ---------------------------------------------------------------------------
// Full (Level 3): block tree WITH materialized input/output.
// ---------------------------------------------------------------------------

export interface FullSpan extends OverviewSpan {
  startTime?: string
  endTime?: string
  input?: unknown
  output?: unknown
  error?: string
  children?: FullSpan[]
}

export interface BlockSelector {
  blockId?: string
  blockName?: string
}

/**
 * Project trace spans to full detail, materializing large-value refs in
 * input/output. When a `selector` is given, only the matching span subtree(s)
 * are returned (and materialized), so a single block's I/O is loaded instead of
 * the whole trace.
 */
export async function toFull(
  spans: TraceSpan[],
  ctx: LogViewContext,
  selector?: BlockSelector
): Promise<FullSpan[]> {
  const roots = selectSpans(spans, selector)
  return Promise.all(roots.map((s) => fullSpan(s, ctx)))
}

function selectSpans(spans: TraceSpan[], selector?: BlockSelector): TraceSpan[] {
  if (!selector || (!selector.blockId && !selector.blockName)) return spans
  const out: TraceSpan[] = []
  const walk = (list: TraceSpan[]): void => {
    for (const s of list) {
      const matches =
        (selector.blockId !== undefined && s.blockId === selector.blockId) ||
        (selector.blockName !== undefined && s.name === selector.blockName)
      if (matches) {
        out.push(s)
      } else if (s.children && s.children.length > 0) {
        walk(s.children)
      }
    }
  }
  walk(spans)
  return out
}

async function fullSpan(s: TraceSpan, ctx: LogViewContext): Promise<FullSpan> {
  const node: FullSpan = {
    id: s.id,
    blockId: s.blockId,
    name: s.name,
    type: s.type,
    status: s.status,
    durationMs: s.duration ?? 0,
    startTime: s.startTime,
    endTime: s.endTime,
  }
  if (s.cost) node.cost = s.cost
  if (s.errorMessage) node.error = s.errorMessage
  if (s.input !== undefined) node.input = await materializeField(s.input, ctx)
  if (s.output !== undefined) node.output = await materializeField(s.output, ctx)
  if (s.children && s.children.length > 0) {
    node.children = await Promise.all(s.children.map((c) => fullSpan(c, ctx)))
  }
  return node
}

/**
 * Resolve a span field that may be inline OR a large-value ref/manifest. Falls
 * back to the ref `preview` (or a placeholder) when the value is unavailable or
 * exceeds caps — never throws.
 */
async function materializeField(value: unknown, ctx: LogViewContext): Promise<unknown> {
  if (isLargeArrayManifest(value)) {
    try {
      return await materializeLargeArrayManifest(value, ctx)
    } catch {
      return value.preview ?? '[large array unavailable]'
    }
  }
  if (isLargeValueRef(value)) {
    try {
      const materialized = await materializeLargeValueRef(value, {
        ...ctx,
        maxBytes: ctx.maxBytes ?? SINGLE_REF_MAX_BYTES,
      })
      return materialized === undefined
        ? (value.preview ?? '[large value unavailable]')
        : materialized
    } catch {
      return value.preview ?? '[large value unavailable]'
    }
  }
  return value
}

// ---------------------------------------------------------------------------
// Grep (single execution): stream large refs chunk-by-chunk, release each.
// ---------------------------------------------------------------------------

export interface GrepSpanMatch {
  spanId: string
  blockId?: string
  name: string
  field: 'name' | 'type' | 'error' | 'input' | 'output'
  snippet: string
}

export interface GrepSpansResult {
  matches: GrepSpanMatch[]
  /**
   * Whether the scan stopped with trace left unread — not whether a budget was
   * reached. Every point that skips work goes through `done`, which sets this,
   * so a budget exhausted by the very last match reports `false`: the caller's
   * results are complete, and nothing was withheld.
   */
  truncated: boolean
  /**
   * Present only when the pattern used syntax RE2 does not implement and was
   * therefore matched literally. The tool catalog cannot warn up front — it is
   * generated from a contract in another repository — so the caller is told
   * here rather than reading zero matches as "not present in the trace".
   */
  patternNotice?: string
}

export interface GrepSpansOptions {
  maxMatches?: number
  maxSnippetChars?: number
  maxSlicesScanned?: number
  maxScannedChars?: number
  matchTimeBudgetMs?: number
}

interface GrepState {
  matches: GrepSpanMatch[]
  slicesScanned: number
  scannedChars: number
  matchTimeMs: number
  truncated: boolean
  maxMatches: number
  maxSnippetChars: number
  maxSlicesScanned: number
  maxScannedChars: number
  matchTimeBudgetMs: number
  find: FindMatch
}

/** Index of the first case-insensitive match in `text`, or -1. */
type FindMatch = (text: string) => number

/**
 * Compile a caller-supplied grep pattern into a matcher that cannot backtrack.
 *
 * Trace text is attacker-influenced — a workflow can emit arbitrarily long
 * uniform runs into its own block outputs — and matching runs synchronously on
 * the shared event loop, so a backtracking engine lets one request stall every
 * other request on the instance. See `@/lib/core/security/linear-regex` for why
 * the engine changed rather than the pattern being screened.
 *
 * A pattern with no metacharacter takes the built-in engine, which is ~100x
 * quicker and identical in meaning when there is nothing to interpret. Syntax
 * RE2 cannot represent degrades to a literal with a notice, so the caller knows
 * its regex was not applied instead of reading zero matches as "not present".
 */
function compilePattern(pattern: string): { find: FindMatch; notice?: string } {
  if (isPlainText(pattern)) return { find: literalRegex(pattern, { ignoreCase: true }).find }

  const compiled = compileLinearRegex(pattern, { ignoreCase: true })
  if (compiled) return { find: compiled.find }

  return {
    find: literalRegex(pattern, { ignoreCase: true }).find,
    notice:
      'Pattern is not valid RE2 syntax (lookahead, lookbehind and backreferences are unsupported), so it was matched as a literal string. Rewrite it without those constructs to search by regex.',
  }
}

function findTimed(text: string, state: GrepState): number {
  const started = performance.now()
  try {
    return state.find(text)
  } finally {
    state.matchTimeMs += performance.now() - started
  }
}

function snippetAround(text: string, index: number, state: GrepState): string {
  const maxChars = state.maxSnippetChars
  const half = Math.floor(maxChars / 2)
  const start = Math.max(0, index - half)
  const end = Math.min(text.length, start + maxChars)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

function done(state: GrepState): boolean {
  if (state.truncated || state.matches.length >= state.maxMatches) return true
  if (state.matchTimeMs >= state.matchTimeBudgetMs) {
    state.truncated = true
    return true
  }
  return false
}

function recordIfMatch(
  text: string,
  field: GrepSpanMatch['field'],
  span: TraceSpan,
  state: GrepState
): void {
  if (done(state)) return
  if (state.scannedChars + text.length > state.maxScannedChars) {
    state.truncated = true
    return
  }
  state.scannedChars += text.length
  const index = findTimed(text, state)
  if (index < 0) return
  state.matches.push({
    spanId: span.id,
    blockId: span.blockId,
    name: span.name,
    field,
    snippet: snippetAround(text, index, state),
  })
  if (state.matches.length >= state.maxMatches) state.truncated = true
}

async function grepField(
  value: unknown,
  field: 'input' | 'output',
  span: TraceSpan,
  ctx: LogViewContext,
  state: GrepState
): Promise<void> {
  if (done(state)) return

  if (isLargeArrayManifest(value)) {
    let start = 0
    while (start < value.totalCount && !done(state)) {
      if (state.slicesScanned >= state.maxSlicesScanned) {
        state.truncated = true
        break
      }
      let slice: unknown[] | null
      try {
        slice = await readLargeArrayManifestSlice(value, start, ARRAY_SLICE_BATCH, ctx)
      } catch {
        // Unavailable chunk: fall back to the manifest preview once and stop.
        recordIfMatch(safeStringify(value.preview), field, span, state)
        return
      }
      state.slicesScanned += 1
      if (slice.length === 0) break
      recordIfMatch(safeStringify(slice), field, span, state)
      start += ARRAY_SLICE_BATCH
      // Release the batch before fetching the next so peak memory ~= one batch.
      slice = null
    }
    return
  }

  if (isLargeValueRef(value)) {
    let materialized: unknown
    try {
      materialized = await materializeLargeValueRef(value, {
        ...ctx,
        maxBytes: ctx.maxBytes ?? SINGLE_REF_MAX_BYTES,
      })
    } catch {
      materialized = undefined
    }
    const text =
      materialized === undefined ? safeStringify(value.preview) : safeStringify(materialized)
    recordIfMatch(text, field, span, state)
    return
  }

  recordIfMatch(safeStringify(value), field, span, state)
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Grep a single execution's trace spans for `pattern`. Inline fields are scanned
 * directly; large-array I/O is streamed slice-by-slice (each released before the
 * next); single large refs are materialized under a byte cap (falling back to
 * the ref preview). Only bounded match snippets are accumulated.
 *
 * `pattern` is matched by a non-backtracking engine — see `compilePattern` — so
 * no pattern can blow up on any input. Two budgets bound total work on top of
 * that: a character budget and a cumulative match-time budget. Neither counts
 * the blob-store I/O this scan awaits, so a slow-but-legitimate grep is not
 * truncated merely for being slow.
 */
export async function grepSpans(
  spans: TraceSpan[],
  pattern: string,
  ctx: LogViewContext,
  opts?: GrepSpansOptions
): Promise<GrepSpansResult> {
  const compiled = compilePattern(pattern)
  const state: GrepState = {
    matches: [],
    slicesScanned: 0,
    scannedChars: 0,
    matchTimeMs: 0,
    truncated: false,
    maxMatches: opts?.maxMatches ?? DEFAULT_MAX_MATCHES,
    maxSnippetChars: opts?.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS,
    maxSlicesScanned: opts?.maxSlicesScanned ?? DEFAULT_MAX_SLICES_SCANNED,
    maxScannedChars: opts?.maxScannedChars ?? DEFAULT_MAX_SCANNED_CHARS,
    matchTimeBudgetMs: opts?.matchTimeBudgetMs ?? DEFAULT_MATCH_TIME_BUDGET_MS,
    find: compiled.find,
  }

  const walk = async (list: TraceSpan[]): Promise<void> => {
    for (const span of list) {
      if (done(state)) return
      recordIfMatch(span.name, 'name', span, state)
      recordIfMatch(span.type, 'type', span, state)
      if (span.errorMessage) recordIfMatch(span.errorMessage, 'error', span, state)
      if (span.input !== undefined) await grepField(span.input, 'input', span, ctx, state)
      if (span.output !== undefined) await grepField(span.output, 'output', span, ctx, state)
      if (span.children && span.children.length > 0) await walk(span.children)
    }
  }

  await walk(spans)
  return {
    matches: state.matches,
    truncated: state.truncated,
    ...(compiled.notice ? { patternNotice: compiled.notice } : {}),
  }
}
