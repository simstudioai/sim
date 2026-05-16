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
