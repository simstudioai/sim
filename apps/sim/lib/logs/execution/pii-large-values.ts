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
 * storage (a >8MB ref) — its bytes live in object storage, not inline. Block
 * outputs are masked BEFORE offload only when the block-output stage is on; when
 * it's off, the refs in a persisted log point to unredacted bytes. This walks the
 * payload and, for each ref / array manifest, materializes it, masks its content,
 * and re-stores a fresh masked ref — so the log keeps the redacted content rather
 * than losing the whole field. Any failure (materialization unavailable, missing
 * storage scope, re-store error) falls back to {@link REDACTION_FAILED_MARKER} so
 * raw PII is never left behind.
 */
export async function redactLargeValueRefs(
  payload: RedactablePayload,
  options: RedactLargeValueRefsOptions
): Promise<RedactablePayload> {
  const result: RedactablePayload = { ...payload }
  for (const key of Object.keys(payload) as (keyof RedactablePayload)[]) {
    if (payload[key] !== undefined) {
      result[key] = await redactNode(payload[key], options)
    }
  }
  return result
}

async function redactNode(node: unknown, options: RedactLargeValueRefsOptions): Promise<unknown> {
  if (isLargeValueRef(node)) {
    return redactRef(node, options)
  }
  if (isLargeArrayManifest(node)) {
    return redactManifest(node, options)
  }
  if (Array.isArray(node)) {
    return Promise.all(node.map((item) => redactNode(item, options)))
  }
  if (node !== null && typeof node === 'object') {
    const entries = await Promise.all(
      Object.entries(node).map(
        async ([key, value]) => [key, await redactNode(value, options)] as const
      )
    )
    return Object.fromEntries(entries)
  }
  return node
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
  const nested = await redactNode(value, options)
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
