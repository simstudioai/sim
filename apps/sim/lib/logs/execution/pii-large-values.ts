import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { LargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import {
  appendLargeArrayManifest,
  createLargeArrayManifest,
  readLargeArrayManifestSlice,
} from '@/lib/execution/payloads/large-array-manifest'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import {
  MAX_DURABLE_LARGE_VALUE_BYTES,
  MAX_INLINE_MATERIALIZATION_BYTES,
} from '@/lib/execution/payloads/materialization.server'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'
import {
  PiiRedactionError,
  type PiiRedactionFailureMode,
  REDACTION_FAILED_MARKER,
  type RedactablePayload,
  redactObjectStrings,
} from '@/lib/logs/execution/pii-redaction'

const logger = createLogger('PiiLargeValues')

export interface RedactLargeValueRefsOptions {
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
  language: string
  /** User-supplied custom regex patterns applied alongside `entityTypes`. */
  customPatterns?: CustomPiiPattern[]
  /** Storage scope for materializing and re-storing the masked values. */
  store: LargeValueStoreContext
  /**
   * How to handle a ref that can't be materialized/masked/re-stored. Defaults to
   * `'scrub'` (marker) — safe for the logs path. The execution-altering restore
   * path passes `'throw'` so an unmaskable restored value aborts the run rather
   * than feeding a marker (or leaking raw bytes) downstream.
   */
  onFailure?: PiiRedactionFailureMode
  /**
   * @internal Shared across every nested invocation spawned from one entry-point
   * call, so oversized hydrations serialize globally — not just within their own
   * {@link resolveReplacements} pass. Created by the entry points; callers never
   * set it.
   */
  oversizedGate?: OversizedHydrationGate
  /**
   * @internal True while running under the gate. Nested oversized work inside a
   * gated ref runs directly instead of re-acquiring — the holder would otherwise
   * wait on itself (deadlock). Safe because the holder is globally serialized.
   */
  withinOversizedGate?: boolean
}

/** Promise-chain mutex for oversized hydrations (see {@link requiresSerialHydration}). */
interface OversizedHydrationGate {
  chain: Promise<void>
}

/** Queue `fn` behind every previously gated task; failures don't poison the chain. */
async function runSerially<T>(gate: OversizedHydrationGate, fn: () => Promise<T>): Promise<T> {
  const run = gate.chain.then(fn)
  gate.chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Ensure one shared gate exists for the whole entry-point call tree. */
function withOversizedGate(options: RedactLargeValueRefsOptions): RedactLargeValueRefsOptions {
  return options.oversizedGate
    ? options
    : { ...options, oversizedGate: { chain: Promise.resolve() } }
}

/**
 * Hydrate, mask, and re-store offloaded large values inside a log payload.
 *
 * The string redactor can't reach a value already offloaded to large-value
 * storage (a >8MB ref) — its bytes live in object storage, not inline. This walks
 * the payload and, for each ref / array manifest, materializes it, masks its
 * content, and re-stores a fresh masked ref — so the log keeps the redacted
 * content rather than losing the whole field. Any failure (materialization
 * unavailable, missing storage scope, re-store error) falls back to
 * {@link REDACTION_FAILED_MARKER} so raw PII is never left behind.
 *
 * Traversal is SYNCHRONOUS (collect refs, then substitute) so a large ref-free
 * payload costs only a cheap walk — never a promise-per-node. Only the handful of
 * actual refs incur async hydrate → mask → re-store work, and those run in
 * parallel with bounded concurrency ({@link REF_CONCURRENCY}).
 */
export async function redactLargeValueRefs(
  payload: RedactablePayload,
  options: RedactLargeValueRefsOptions
): Promise<RedactablePayload> {
  const gatedOptions = withOversizedGate(options)
  // Collect refs across the WHOLE payload first (shared `seen`), so every ref is
  // hydrated+masked+re-stored in one bounded-concurrency pass instead of one
  // sequential pass per key. A ref shared across keys is walked/masked once.
  const refs: object[] = []
  const seen = new WeakSet<object>()
  for (const key of Object.keys(payload) as (keyof RedactablePayload)[]) {
    if (payload[key] !== undefined) collectRefs(payload[key], refs, seen)
  }
  if (refs.length === 0) return payload

  const replacements = await resolveReplacements(refs, gatedOptions)
  const result: RedactablePayload = { ...payload }
  for (const key of Object.keys(payload) as (keyof RedactablePayload)[]) {
    if (payload[key] !== undefined) result[key] = substituteRefs(payload[key], replacements)
  }
  return result
}

/**
 * Hydrate, mask, and re-store offloaded large values inside an arbitrary value
 * (e.g. resumed snapshot `blockStates`) — the same walk as
 * {@link redactLargeValueRefs}, but not bound to the {@link RedactablePayload}
 * key set. Structure is preserved; only refs/manifests are replaced.
 */
export async function redactLargeValueRefsInValue<T>(
  value: T,
  options: RedactLargeValueRefsOptions
): Promise<T> {
  return (await redactValueRefs(value, withOversizedGate(options))) as T
}

/** Sync-collect every ref/manifest in `value`, then async-replace each, then sync-substitute. */
async function redactValueRefs(
  value: unknown,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  const refs: object[] = []
  collectRefs(value, refs, new WeakSet())
  if (refs.length === 0) return value

  const replacements = await resolveReplacements(refs, options)
  return substituteRefs(value, replacements)
}

/**
 * Max large-value refs hydrated → masked → re-stored in parallel per payload.
 * Multiplies with the mask-batch chunk concurrency for total in-flight Presidio
 * load, which the load-balanced fleet behind the internal ALB absorbs.
 */
const REF_CONCURRENCY = env.PII_REF_CONCURRENCY ?? 4

/**
 * A single ref past the default inline ceiling hydrates its whole blob at once
 * (~2-3× its serialized size in transient heap) — and a manifest whose packer
 * emitted an oversized chunk (a single item larger than the chunk target)
 * hydrates that chunk the same way. Those run serially instead of in the
 * {@link REF_CONCURRENCY} pool — one 64MB hydration is fine, four at once is an
 * OOM on the small trigger.dev machines. Normally-chunked manifests page ~8MB
 * at a time and stay pooled regardless of total size.
 */
function requiresSerialHydration(ref: object): boolean {
  if (isLargeValueRef(ref)) {
    return ref.size > MAX_INLINE_MATERIALIZATION_BYTES
  }
  if (isLargeArrayManifest(ref)) {
    return ref.chunks.some((chunk) => chunk.byteSize > MAX_INLINE_MATERIALIZATION_BYTES)
  }
  return false
}

/**
 * Dedupe the collected refs by identity, then replace each in parallel (bounded by
 * {@link REF_CONCURRENCY}); refs needing an oversized hydration run serially after
 * the pool drains (see {@link requiresSerialHydration}). `Map.set` is synchronous,
 * so concurrent workers writing the shared map do not race.
 *
 * `mapWithConcurrency`'s `fn` must not reject (a rejection fails the pool
 * non-deterministically), so the mapper is total: it catches per-ref errors and
 * records the first one. In `onFailure: 'throw'` mode `replaceRef` throws, so after
 * the pool drains we rethrow that first error — an unmaskable ref still aborts the
 * run rather than passing through. In `'scrub'` mode `replaceRef` never throws.
 */
async function resolveReplacements(
  refs: object[],
  options: RedactLargeValueRefsOptions
): Promise<Map<object, unknown>> {
  const unique = [...new Set(refs)]
  const pooled = unique.filter((ref) => !requiresSerialHydration(ref))
  const oversized = unique.filter(requiresSerialHydration)
  const replacements = new Map<object, unknown>()
  let firstError: unknown
  const resolveOne = async (ref: object, opts: RedactLargeValueRefsOptions): Promise<void> => {
    try {
      replacements.set(ref, await replaceRef(ref, opts))
    } catch (error) {
      if (firstError === undefined) firstError = error
    }
  }
  await mapWithConcurrency(pooled, REF_CONCURRENCY, (ref) => resolveOne(ref, options))
  const gate = options.oversizedGate
  for (const ref of oversized) {
    if (!gate || options.withinOversizedGate) {
      // Already serialized by a gated ancestor (or no gate: direct internal
      // call) — re-acquiring would deadlock on the ancestor's own hold.
      await resolveOne(ref, options)
    } else {
      await runSerially(gate, () => resolveOne(ref, { ...options, withinOversizedGate: true }))
    }
  }
  if (firstError !== undefined) throw firstError
  return replacements
}

/** Depth-first sync walk collecting ref/manifest nodes (not recursing into them). */
function collectRefs(value: unknown, out: object[], seen: WeakSet<object>): void {
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    out.push(value as object)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out, seen)
    return
  }
  for (const v of Object.values(value)) collectRefs(v, out, seen)
}

/** Sync rebuild of `value` with each collected ref swapped for its replacement (by identity). */
function substituteRefs(value: unknown, replacements: Map<object, unknown>): unknown {
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    return replacements.has(value as object) ? replacements.get(value as object) : value
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => substituteRefs(item, replacements))
  }
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    out[key] = substituteRefs(v, replacements)
  }
  return out
}

async function replaceRef(ref: object, options: RedactLargeValueRefsOptions): Promise<unknown> {
  return isLargeValueRef(ref)
    ? redactRef(ref, options)
    : redactManifest(ref as LargeArrayManifest, options)
}

/**
 * Mask a materialized value: mask inline strings first (`redactObjectStrings`
 * treats refs as opaque), then replace any nested refs with their own masked
 * results. Strings-first matters — a nested ref whose masked value shrinks
 * below the offload threshold comes back inline, and running the string pass
 * after substitution would mask that already-masked content a second time
 * (non-idempotent for custom patterns).
 */
async function maskMaterializedValue(
  value: unknown,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  const masked = await redactObjectStrings(value, {
    entityTypes: options.entityTypes,
    language: options.language,
    customPatterns: options.customPatterns,
    onFailure: options.onFailure ?? 'scrub',
  })
  return redactValueRefs(masked, options)
}

/** Mask a materialized large value and re-offload it as a fresh durable ref. */
async function maskAndReStore(
  value: unknown,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  const masked = await maskMaterializedValue(value, options)
  return compactExecutionPayload(masked, { ...options.store, requireDurable: true })
}

/** Rethrow (as {@link PiiRedactionError}) or scrub-to-marker, per `onFailure`. */
function onRefFailure(
  error: unknown,
  options: RedactLargeValueRefsOptions,
  context: string
): never | string {
  if ((options.onFailure ?? 'scrub') === 'throw') {
    throw error instanceof PiiRedactionError
      ? error
      : new PiiRedactionError(`${context}: ${getErrorMessage(error)}`)
  }
  logger.error(`${context}; scrubbing`, { error: getErrorMessage(error) })
  return REDACTION_FAILED_MARKER
}

async function redactRef(
  ref: LargeValueRef,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  try {
    const materialized = await materializeLargeValueRef(ref, {
      ...options.store,
      trackReference: false,
      // Redaction must hydrate refs past the default inline ceiling to mask
      // them; refs above that ceiling are scheduled serially (see
      // isOversizedSingleRef) so the raised budget never multiplies across the
      // concurrency pool.
      maxBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
    })
    if (materialized === undefined) {
      return onRefFailure(
        new Error('large value could not be materialized'),
        options,
        'Failed to redact large value ref'
      )
    }
    return await maskAndReStore(materialized, options)
  } catch (error) {
    return onRefFailure(error, options, 'Failed to redact large value ref')
  }
}

/**
 * Mask a large-array manifest chunk-by-chunk: page one stored chunk at a time,
 * mask nested refs + strings in that slice, and append the masked items to a
 * fresh manifest. Peak memory stays ~one chunk regardless of the manifest's
 * total `byteSize`, so a large offloaded array never trips the inline
 * materialization ceiling. The rebuilt manifest re-chunks by byte target,
 * recomputes `count`/`byteSize` bookkeeping from the masked items, and derives
 * `preview` from masked content — the source manifest's preview holds raw items
 * and must never be carried forward.
 */
async function redactManifest(
  manifest: LargeArrayManifest,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  try {
    const readContext = {
      ...options.store,
      trackReference: false,
      // Chunks target ~8MB, but a single item larger than the target still
      // occupies its own chunk — allow those up to the durable cap since they
      // hydrate one at a time.
      maxBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
    }
    let masked: LargeArrayManifest | undefined
    let cursor = 0
    for (const chunk of manifest.chunks) {
      const slice = await readLargeArrayManifestSlice(manifest, cursor, chunk.count, readContext)
      cursor += chunk.count
      const items = (await maskMaterializedValue(slice, options)) as unknown[]
      masked =
        masked === undefined
          ? await createLargeArrayManifest(items, { ...options.store })
          : await appendLargeArrayManifest(masked, items, { ...options.store })
    }
    if (masked === undefined) {
      return createLargeArrayManifest([], { ...options.store })
    }
    if (masked.totalCount !== manifest.totalCount) {
      throw new Error('Masked manifest item count does not match the source manifest.')
    }
    return masked
  } catch (error) {
    return onRefFailure(error, options, 'Failed to redact large array manifest')
  }
}
