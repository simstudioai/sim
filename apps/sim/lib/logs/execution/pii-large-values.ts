import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { LargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { materializeLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
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
  /** Storage scope for materializing and re-storing the masked values. */
  store: LargeValueStoreContext
  /**
   * How to handle a ref that can't be materialized/masked/re-stored. Defaults to
   * `'scrub'` (marker) — safe for the logs path. The execution-altering restore
   * path passes `'throw'` so an unmaskable restored value aborts the run rather
   * than feeding a marker (or leaking raw bytes) downstream.
   */
  onFailure?: PiiRedactionFailureMode
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
  // Collect refs across the WHOLE payload first (shared `seen`), so every ref is
  // hydrated+masked+re-stored in one bounded-concurrency pass instead of one
  // sequential pass per key. A ref shared across keys is walked/masked once.
  const refs: object[] = []
  const seen = new WeakSet<object>()
  for (const key of Object.keys(payload) as (keyof RedactablePayload)[]) {
    if (payload[key] !== undefined) collectRefs(payload[key], refs, seen)
  }
  if (refs.length === 0) return payload

  const replacements = await resolveReplacements(refs, options)
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
  return (await redactValueRefs(value, options)) as T
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
 * Dedupe the collected refs by identity, then replace each in parallel (bounded by
 * {@link REF_CONCURRENCY}). `Map.set` is synchronous, so concurrent workers writing
 * the shared map do not race.
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
  const replacements = new Map<object, unknown>()
  let firstError: unknown
  await mapWithConcurrency(unique, REF_CONCURRENCY, async (ref) => {
    try {
      replacements.set(ref, await replaceRef(ref, options))
    } catch (error) {
      if (firstError === undefined) firstError = error
    }
  })
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
 * Mask a materialized large value and re-offload it: handle any nested refs
 * first, then mask inline strings, then re-store. `redactObjectStrings` skips
 * refs, so the nested re-stored refs are left intact while their siblings mask.
 */
async function maskAndReStore(
  value: unknown,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  const nested = await redactValueRefs(value, options)
  const masked = await redactObjectStrings(nested, {
    entityTypes: options.entityTypes,
    language: options.language,
    onFailure: options.onFailure ?? 'scrub',
  })
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

async function redactManifest(
  manifest: LargeArrayManifest,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  try {
    const materialized = await materializeLargeArrayManifest(manifest, { ...options.store })
    return await maskAndReStore(materialized, options)
  } catch (error) {
    return onRefFailure(error, options, 'Failed to redact large array manifest')
  }
}
