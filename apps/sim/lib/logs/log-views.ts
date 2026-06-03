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
  truncated: boolean
}

export interface GrepSpansOptions {
  maxMatches?: number
  maxSnippetChars?: number
  maxSlicesScanned?: number
}

interface GrepState {
  matches: GrepSpanMatch[]
  slicesScanned: number
  truncated: boolean
  maxMatches: number
  maxSnippetChars: number
  maxSlicesScanned: number
  regex: RegExp
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return new RegExp(escapeRegExp(pattern), 'i')
  }
}

function snippetAround(text: string, regex: RegExp, maxChars: number): string {
  const m = regex.exec(text)
  const index = m ? m.index : 0
  const half = Math.floor(maxChars / 2)
  const start = Math.max(0, index - half)
  const end = Math.min(text.length, start + maxChars)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

function done(state: GrepState): boolean {
  return state.truncated || state.matches.length >= state.maxMatches
}

function recordIfMatch(
  text: string,
  field: GrepSpanMatch['field'],
  span: TraceSpan,
  state: GrepState
): void {
  if (done(state)) return
  state.regex.lastIndex = 0
  if (!state.regex.test(text)) return
  state.regex.lastIndex = 0
  state.matches.push({
    spanId: span.id,
    blockId: span.blockId,
    name: span.name,
    field,
    snippet: snippetAround(text, state.regex, state.maxSnippetChars),
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
 */
export async function grepSpans(
  spans: TraceSpan[],
  pattern: string,
  ctx: LogViewContext,
  opts?: GrepSpansOptions
): Promise<GrepSpansResult> {
  const state: GrepState = {
    matches: [],
    slicesScanned: 0,
    truncated: false,
    maxMatches: opts?.maxMatches ?? DEFAULT_MAX_MATCHES,
    maxSnippetChars: opts?.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS,
    maxSlicesScanned: opts?.maxSlicesScanned ?? DEFAULT_MAX_SLICES_SCANNED,
    regex: buildRegex(pattern),
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
  return { matches: state.matches, truncated: state.truncated }
}
