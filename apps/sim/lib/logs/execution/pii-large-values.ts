import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { LargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { materializeLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import {
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
 * actual refs incur async hydrate → mask → re-store work.
 */
export async function redactLargeValueRefs(
  payload: RedactablePayload,
  options: RedactLargeValueRefsOptions
): Promise<RedactablePayload> {
  const result: RedactablePayload = { ...payload }
  for (const key of Object.keys(payload) as (keyof RedactablePayload)[]) {
    if (payload[key] !== undefined) {
      result[key] = await redactValueRefs(payload[key], options)
    }
  }
  return result
}

/** Sync-collect every ref/manifest in `value`, then async-replace each, then sync-substitute. */
async function redactValueRefs(
  value: unknown,
  options: RedactLargeValueRefsOptions
): Promise<unknown> {
  const refs: object[] = []
  collectRefs(value, refs, new WeakSet())
  if (refs.length === 0) return value

  const replacements = new Map<object, unknown>()
  for (const ref of refs) {
    if (replacements.has(ref)) continue
    replacements.set(ref, await replaceRef(ref, options))
  }
  return substituteRefs(value, replacements)
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
    onFailure: 'scrub',
  })
  return compactExecutionPayload(masked, { ...options.store, requireDurable: true })
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
    if (materialized === undefined) return REDACTION_FAILED_MARKER
    return await maskAndReStore(materialized, options)
  } catch (error) {
    logger.error('Failed to redact large value ref; scrubbing', { error: getErrorMessage(error) })
    return REDACTION_FAILED_MARKER
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
    logger.error('Failed to redact large array manifest; scrubbing', {
      error: getErrorMessage(error),
    })
    return REDACTION_FAILED_MARKER
  }
}
