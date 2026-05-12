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
 * Default retry pacing shared by destination backoff loops: 500 ms floor,
 * 30 s ceiling, ±20% jitter.
 */
const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_BACKOFF_MAX_MS = 30_000

export interface BackoffOptions {
  baseMs?: number
  maxMs?: number
}

/**
 * Computes the next delay for a retry loop. When the server returned a
 * `Retry-After` (`retryAfterMs` is non-null), the value is clamped to
 * `[baseMs, maxMs]` so a malformed `Retry-After: 0` cannot pin the loop into a
 * tight retry. Otherwise returns exponential backoff with ±20% jitter to avoid
 * thundering-herd alignment across concurrent drains. Attempt is 1-indexed.
 */
export function backoffWithJitter(
  attempt: number,
  retryAfterMs: number | null,
  options: BackoffOptions = {}
): number {
  const baseMs = options.baseMs ?? DEFAULT_BACKOFF_BASE_MS
  const maxMs = options.maxMs ?? DEFAULT_BACKOFF_MAX_MS
  if (retryAfterMs !== null) {
    return Math.min(Math.max(retryAfterMs, baseMs), maxMs)
  }
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), maxMs)
  return exponential * (0.8 + Math.random() * 0.4)
}

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
export interface ParseNdjsonObjectsOptions {
  /** When true, throw if a parsed value is not a plain object. */
  requireObject?: boolean
}

/**
 * Parses an NDJSON buffer into per-row JSON values. Error messages use
 * 1-indexed line numbers so they line up with how editors and `Content-Range`
 * headers reference NDJSON payloads.
 */
export function parseNdjsonObjects(
  body: Buffer,
  options: ParseNdjsonObjectsOptions = {}
): unknown[] {
  const text = body.toString('utf8')
  const rows: unknown[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(`NDJSON parse failed at line ${i + 1}: ${toError(error).message}`)
    }
    if (options.requireObject) {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`NDJSON row at line ${i + 1} is not an object`)
      }
    }
    rows.push(parsed)
  }
  return rows
}

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
