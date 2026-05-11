import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { JWT } from 'google-auth-library'
import { z } from 'zod'
import type { DeliveryMetadata, DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainBigQueryDestination')

/**
 * `bigquery.insertdata` covers the `tabledata.insertAll` streaming endpoint.
 * `bigquery.readonly` is required for the `tables.get` probe used by `test()` —
 * `insertdata` alone returns 403 on `tables.get` even when the service account
 * has the `roles/bigquery.dataEditor` IAM role.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/bigquery.insertdata',
  'https://www.googleapis.com/auth/bigquery.readonly',
]

/**
 * Allows both standard project IDs (`my-project`) and domain-scoped project
 * IDs (`example.com:my-project`). The optional domain prefix matches Google
 * Cloud's legacy domain-scoped project format.
 */
const PROJECT_ID_RE = /^([a-z][a-z0-9.-]{0,61}[a-z0-9]:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const DATASET_OR_TABLE_RE = /^[A-Za-z0-9_]{1,1024}$/

const USER_AGENT = 'sim-data-drain/1.0'
/** Streaming insertAll limits per request: 10 MB body, 50,000 rows. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024
const MAX_ROWS_PER_REQUEST = 50_000
/** BigQuery caps insertId at 128 characters. */
const MAX_INSERT_ID_LENGTH = 128

const bigqueryConfigSchema = z.object({
  projectId: z
    .string()
    .min(6, 'projectId is required')
    .refine((v) => PROJECT_ID_RE.test(v), {
      message: 'projectId must match Google Cloud project ID rules',
    }),
  datasetId: z
    .string()
    .min(1, 'datasetId is required')
    .refine((v) => DATASET_OR_TABLE_RE.test(v), {
      message: 'datasetId may only contain letters, digits, and underscores',
    }),
  tableId: z
    .string()
    .min(1, 'tableId is required')
    .refine((v) => DATASET_OR_TABLE_RE.test(v), {
      message: 'tableId may only contain letters, digits, and underscores',
    }),
})

const bigqueryCredentialsSchema = z
  .object({
    serviceAccountJson: z.string().min(1, 'serviceAccountJson is required'),
  })
  .superRefine((value, ctx) => {
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
  })

export type BigQueryDestinationConfig = z.infer<typeof bigqueryConfigSchema>
export type BigQueryDestinationCredentials = z.infer<typeof bigqueryCredentialsSchema>

interface ParsedServiceAccount {
  clientEmail: string
  privateKey: string
}

function parseServiceAccount(json: string): ParsedServiceAccount {
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

function buildJwt(account: ParsedServiceAccount): JWT {
  return new JWT({ email: account.clientEmail, key: account.privateKey, scopes: SCOPES })
}

async function getAccessToken(jwt: JWT, forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    // Drop the cached credentials so the next call re-issues a fresh token.
    jwt.credentials = {}
  }
  const { token } = await jwt.getAccessToken()
  if (!token) throw new Error('Failed to obtain BigQuery access token')
  return token
}

function parseNdjson(body: Buffer): Record<string, unknown>[] {
  const text = body.toString('utf8')
  const rows: Record<string, unknown>[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(`NDJSON parse failed at line ${i}: ${toError(error).message}`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`NDJSON row ${i} is not an object`)
    }
    rows.push(parsed as Record<string, unknown>)
  }
  return rows
}

interface InsertAllInput {
  config: BigQueryDestinationConfig
  rows: Record<string, unknown>[]
  metadata: DeliveryMetadata
  jwt: JWT
  signal: AbortSignal
}

interface InsertAllError {
  index: number
  errors: Array<{ reason?: string; message?: string; location?: string }>
}

async function postInsertAll(
  input: InsertAllInput,
  url: string,
  body: string,
  forceRefresh = false
): Promise<Response> {
  const token = await getAccessToken(input.jwt, forceRefresh)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body,
      signal: input.signal,
    })
  } catch (error) {
    logger.warn('BigQuery request failed', {
      table: `${input.config.projectId}.${input.config.datasetId}.${input.config.tableId}`,
      error: toError(error).message,
    })
    throw error
  }
}

function buildInsertId(metadata: DeliveryMetadata, index: number): string {
  // BigQuery dedupes inserts with the same insertId for ~1 minute, so a
  // retried chunk doesn't create duplicate rows when the original delivery
  // partially succeeded but the response was lost. Prefix with `drainId` so
  // (runId, sequence) collisions across drains can't accidentally dedupe.
  // Cap at 128 chars per spec.
  return `${metadata.drainId}-${metadata.runId}-${metadata.sequence}-${index}`.slice(
    0,
    MAX_INSERT_ID_LENGTH
  )
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRY_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 250

function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
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

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now()
    if (delta > 0) return Math.min(delta, 30_000)
  }
  return null
}

/**
 * Streams a chunk of rows to `tabledata.insertAll`.
 *
 * Partial-success caveat: BigQuery may return HTTP 200 with a non-empty
 * `insertErrors` array. The rows NOT listed in `insertErrors` are inserted and
 * dedup-keyed by `insertId` for ~60 seconds. We throw on any `insertErrors` so
 * the outer driver surfaces the failure, but if the driver retries the same
 * chunk after the dedup window expires, the previously-succeeded rows will
 * duplicate. The error message and the accompanying `partialFailure` warning
 * include enough context for operators to recognize and triage this case.
 */
async function insertAll(input: InsertAllInput): Promise<void> {
  if (input.rows.length > MAX_ROWS_PER_REQUEST) {
    throw new Error(
      `BigQuery insertAll chunk has ${input.rows.length} rows, exceeds the ${MAX_ROWS_PER_REQUEST} per-request limit`
    )
  }
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(input.config.projectId)}/datasets/${encodeURIComponent(input.config.datasetId)}/tables/${encodeURIComponent(input.config.tableId)}/insertAll`
  const payload = {
    skipInvalidRows: false,
    ignoreUnknownValues: false,
    rows: input.rows.map((row, index) => ({
      insertId: buildInsertId(input.metadata, index),
      json: row,
    })),
  }
  const body = JSON.stringify(payload)
  const byteLength = Buffer.byteLength(body, 'utf8')
  if (byteLength > MAX_REQUEST_BYTES) {
    throw new Error(
      `BigQuery insertAll body is ${byteLength} bytes, exceeds the ${MAX_REQUEST_BYTES}-byte per-request limit`
    )
  }
  let attempt = 0
  let response: Response
  let refreshedOnce = false
  while (true) {
    attempt++
    response = await postInsertAll(input, url, body)
    // 401: refresh token and retry once; this attempt does not count toward
    // the 5xx/429 retry budget.
    if (response.status === 401 && !refreshedOnce) {
      refreshedOnce = true
      logger.debug('BigQuery returned 401; refreshing access token and retrying once')
      response = await postInsertAll(input, url, body, true)
    }
    if (!RETRYABLE_STATUSES.has(response.status)) break
    if (attempt >= MAX_RETRY_ATTEMPTS) break
    const retryAfterMs =
      parseRetryAfter(response.headers.get('retry-after')) ??
      BASE_RETRY_DELAY_MS * 2 ** (attempt - 1)
    logger.warn('BigQuery insertAll transient error; retrying', {
      status: response.status,
      attempt,
      retryAfterMs,
    })
    // Drain the body so the connection can be reused.
    await response.text().catch(() => '')
    await sleepUntilAborted(retryAfterMs, input.signal)
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`BigQuery insertAll failed (HTTP ${response.status}): ${text}`)
  }
  const result = (await response.json().catch(() => ({}))) as {
    insertErrors?: InsertAllError[]
  }
  if (result.insertErrors && result.insertErrors.length > 0) {
    const failedIndices = result.insertErrors.map((e) => e.index)
    const total = input.rows.length
    const failed = result.insertErrors.length
    const succeeded = total - failed
    logger.warn('BigQuery insertAll returned partial failure', {
      partialFailure: true,
      table: `${input.config.projectId}.${input.config.datasetId}.${input.config.tableId}`,
      succeededRows: succeeded,
      failedRows: failed,
      failedIndices: failedIndices.slice(0, 20),
    })
    const summary = result.insertErrors
      .slice(0, 3)
      .map(
        (e) =>
          `row ${e.index}: ${e.errors.map((er) => er.message ?? er.reason ?? 'unknown').join('; ')}`
      )
      .join(' | ')
    throw new Error(
      `BigQuery insertAll partial failure: ${failed} of ${total} rows failed (indices: ${failedIndices.slice(0, 20).join(',')}${failedIndices.length > 20 ? ',...' : ''}); ${succeeded} rows were inserted and are dedup-keyed by insertId for ~60s — retries within that window are safe, but retries after the window may duplicate the succeeded rows. First errors: ${summary}`
    )
  }
}

export const bigqueryDestination: DrainDestination<
  BigQueryDestinationConfig,
  BigQueryDestinationCredentials
> = {
  type: 'bigquery',
  displayName: 'Google BigQuery',
  configSchema: bigqueryConfigSchema,
  credentialsSchema: bigqueryCredentialsSchema,

  async test({ config, credentials, signal }) {
    const account = parseServiceAccount(credentials.serviceAccountJson)
    const jwt = buildJwt(account)
    const token = await getAccessToken(jwt)
    // Probe table existence and access without inserting any rows. A GET on
    // tables.get with `?fields=id` is a cheap auth + existence check.
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.projectId)}/datasets/${encodeURIComponent(config.datasetId)}/tables/${encodeURIComponent(config.tableId)}?fields=id`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`BigQuery probe failed (HTTP ${response.status}): ${text}`)
    }
  },

  openSession({ config, credentials }) {
    const account = parseServiceAccount(credentials.serviceAccountJson)
    const jwt = buildJwt(account)
    return {
      async deliver({ body, metadata, signal }) {
        const rows = parseNdjson(body)
        if (rows.length === 0) {
          return {
            locator: `bigquery://${config.projectId}/${config.datasetId}/${config.tableId}#${metadata.runId}-${metadata.sequence}`,
          }
        }
        await insertAll({ config, rows, metadata, jwt, signal })
        logger.debug('BigQuery chunk delivered', {
          table: `${config.projectId}.${config.datasetId}.${config.tableId}`,
          rows: rows.length,
        })
        return {
          locator: `bigquery://${config.projectId}/${config.datasetId}/${config.tableId}#${metadata.runId}-${metadata.sequence}`,
        }
      },
      async close() {},
    }
  },
}
