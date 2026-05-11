import { toError } from '@sim/utils/errors'
import { z } from 'zod'

/**
 * Sleep for `ms` milliseconds, resolving early if `signal` aborts. Used by
 * destination retry/poll loops so cancelled drain runs do not hang waiting on
 * a `setTimeout` that ignores the abort signal.
 */
export function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeoutId)
      resolve()
    }
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Strips leading and trailing slashes from a path prefix and re-appends a
 * single trailing slash. Object stores reject keys that begin with `/`
 * (it produces an empty-name segment), and we want exactly one boundary
 * between prefix and the rest of the key.
 */
/**
 * Maximum HTTP Retry-After value we honor. A server requesting >30s is treated
 * as a 30s delay so a misconfigured upstream can't stall a drain run.
 */
const RETRY_AFTER_MAX_MS = 30_000

/**
 * Parses an HTTP `Retry-After` header (either delta-seconds or HTTP-date) into
 * a millisecond delay, capped at 30s. Returns `null` when the header is
 * absent or unparseable so callers can fall back to their own backoff.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (trimmed.length === 0) return null
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.floor(seconds * 1000), RETRY_AFTER_MAX_MS)
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    if (delta <= 0) return 0
    return Math.min(delta, RETRY_AFTER_MAX_MS)
  }
  return null
}

export function normalizePrefix(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed.length === 0 ? '' : `${trimmed}/`
}

export interface ObjectKeyMetadata {
  drainId: string
  runId: string
  source: string
  sequence: number
  runStartedAt: Date
}

/**
 * Builds a date-partitioned NDJSON object key for blob-store destinations.
 * Layout: `<prefix><source>/<drainId>/<YYYY>/<MM>/<DD>/<runId>-<seq>.ndjson`.
 * Partition uses the run's start time so all chunks from a run share one
 * date prefix even if delivery crosses a UTC midnight boundary.
 */
export function buildObjectKey(prefix: string | undefined, metadata: ObjectKeyMetadata): string {
  const partition = metadata.runStartedAt
  const yyyy = partition.getUTCFullYear().toString().padStart(4, '0')
  const mm = (partition.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = partition.getUTCDate().toString().padStart(2, '0')
  const seq = metadata.sequence.toString().padStart(5, '0')
  return `${normalizePrefix(prefix)}${metadata.source}/${metadata.drainId}/${yyyy}/${mm}/${dd}/${metadata.runId}-${seq}.ndjson`
}

export interface ParsedServiceAccount {
  clientEmail: string
  privateKey: string
}

/**
 * Parses a Google service-account JSON key, returning the only two fields
 * that destinations need (client email + private key). Shared by GCS and
 * BigQuery so a fix in one place applies to both.
 */
export function parseServiceAccount(json: string): ParsedServiceAccount {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`serviceAccountJson is not valid JSON: ${toError(error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('serviceAccountJson must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const clientEmail = obj.client_email
  const privateKey = obj.private_key
  if (typeof clientEmail !== 'string' || clientEmail.length === 0) {
    throw new Error('serviceAccountJson is missing client_email')
  }
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw new Error('serviceAccountJson is missing private_key')
  }
  return { clientEmail, privateKey }
}

/**
 * Zod `superRefine` helper that validates a service-account JSON key string
 * is parseable and carries `client_email` + `private_key`. Used by both
 * `gcsCredentialsSchema` and `bigqueryCredentialsSchema`.
 */
export function refineServiceAccountJson(
  value: { serviceAccountJson: string },
  ctx: z.RefinementCtx
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(value.serviceAccountJson)
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serviceAccountJson'],
      message: 'serviceAccountJson must be valid JSON',
    })
    return
  }
  if (typeof parsed !== 'object' || parsed === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serviceAccountJson'],
      message: 'serviceAccountJson must be a JSON object',
    })
    return
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.client_email !== 'string' || obj.client_email.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serviceAccountJson'],
      message: 'serviceAccountJson is missing client_email',
    })
  }
  if (typeof obj.private_key !== 'string' || obj.private_key.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serviceAccountJson'],
      message: 'serviceAccountJson is missing private_key',
    })
  }
}
