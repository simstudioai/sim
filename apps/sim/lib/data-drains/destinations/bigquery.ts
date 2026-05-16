import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { JWT } from 'google-auth-library'
import { z } from 'zod'
import {
  type ParsedServiceAccount,
  parseNdjsonObjects,
  parseServiceAccount,
  refineServiceAccountJson,
  sleepUntilAborted,
} from '@/lib/data-drains/destinations/utils'
import type { DeliveryMetadata, DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainBigQueryDestination')

/**
 * Uses the legacy `tabledata.insertAll` streaming endpoint. The Storage Write
 * API offers exactly-once semantics and lower pricing but requires gRPC; we
 * stay on insertAll for simplicity and direct HTTP support.
 */

/** `insertdata` for streaming inserts; `readonly` for the `tables.get` probe in `test()`. */
const SCOPES = [
  'https://www.googleapis.com/auth/bigquery.insertdata',
  'https://www.googleapis.com/auth/bigquery.readonly',
]

/** Standard project IDs are 6-30 chars; the optional `domain.tld:` prefix supports legacy domain-scoped projects. */
const PROJECT_ID_RE = /^([a-z][a-z0-9.-]{0,61}[a-z0-9]:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const DATASET_RE = /^[A-Za-z0-9_]{1,1024}$/
const TABLE_RE = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd} ]{1,1024}$/u

const USER_AGENT = 'sim-data-drain/1.0'
/** Per-request streaming limits: 10 MB body, 50,000 rows, 1 MB per row. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024
const MAX_ROWS_PER_REQUEST = 50_000
const MAX_ROW_BYTES = 1024 * 1024
/** `insertId` is capped at 128 characters (encoded length). */
const MAX_INSERT_ID_LENGTH = 128
const PER_ATTEMPT_TIMEOUT_MS = 60_000

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
    .refine((v) => DATASET_RE.test(v), {
      message: 'datasetId may only contain ASCII letters, digits, and underscores (max 1024 chars)',
    }),
  tableId: z
    .string()
    .min(1, 'tableId is required')
    .refine((v) => TABLE_RE.test(v), {
      message:
        'tableId may only contain Unicode letters/marks/numbers, connectors, dashes, and spaces (max 1024 chars)',
    })
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 1024, {
      message: 'tableId must be at most 1024 bytes when UTF-8 encoded',
    }),
})

const bigqueryCredentialsSchema = z
  .object({
    serviceAccountJson: z.string().min(1, 'serviceAccountJson is required'),
  })
  .superRefine(refineServiceAccountJson)

export type BigQueryDestinationConfig = z.infer<typeof bigqueryConfigSchema>
export type BigQueryDestinationCredentials = z.infer<typeof bigqueryCredentialsSchema>

function buildJwt(account: ParsedServiceAccount): JWT {
  return new JWT({ email: account.clientEmail, key: account.privateKey, scopes: SCOPES })
}

async function getAccessToken(jwt: JWT, forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    /** Clearing `credentials` forces `getAccessToken` to mint a new token instead of returning the cached one. */
    jwt.credentials = {}
  }
  const { token } = await jwt.getAccessToken()
  if (!token) throw new Error('Failed to obtain BigQuery access token')
  return token
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
  const perAttempt = AbortSignal.any([input.signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body,
      signal: perAttempt,
    })
  } catch (error) {
    logger.warn('BigQuery request failed', {
      table: `${input.config.projectId}.${input.config.datasetId}.${input.config.tableId}`,
      error: toError(error).message,
    })
    throw error
  }
}

/**
 * Builds a stable `insertId` for best-effort dedup (~60s window). Prefixed
 * with `drainId` so (runId, sequence) collisions across drains do not
 * accidentally dedupe each other's rows. With UUID drain/run IDs the raw
 * form fits well under 128 chars; if anything pushes it over (e.g. a future
 * non-UUID id), hash the prefix and keep the row-distinguishing `index`
 * suffix intact so BigQuery does not silently dedupe distinct rows.
 */
function buildInsertId(metadata: DeliveryMetadata, index: number): string {
  const raw = `${metadata.drainId}-${metadata.runId}-${metadata.sequence}-${index}`
  if (raw.length <= MAX_INSERT_ID_LENGTH) return raw
  const prefixHash = createHash('sha1')
    .update(`${metadata.drainId}-${metadata.runId}-${metadata.sequence}`)
    .digest('hex')
  return `${prefixHash}-${index}`
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRY_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 250

/**
 * Streams a chunk of rows to `tabledata.insertAll`.
 *
 * Partial-success caveat: BigQuery may return HTTP 200 with a non-empty
 * `insertErrors` array. Rows not listed there are inserted and dedup-keyed by
 * `insertId` for ~60s. We throw on any `insertErrors`; retries within the
 * dedup window are safe, but retries after it may duplicate succeeded rows.
 */
async function insertAll(input: InsertAllInput): Promise<void> {
  if (input.rows.length > MAX_ROWS_PER_REQUEST) {
    throw new Error(
      `BigQuery insertAll chunk has ${input.rows.length} rows, exceeds the ${MAX_ROWS_PER_REQUEST} per-request limit`
    )
  }
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(input.config.projectId)}/datasets/${encodeURIComponent(input.config.datasetId)}/tables/${encodeURIComponent(input.config.tableId)}/insertAll`
  /**
   * `skipInvalidRows: false` and `ignoreUnknownValues: false` surface schema
   * mismatches as `insertErrors` instead of silently dropping data — drains
   * should fail loudly so operators notice the schema drift.
   */
  const payload = {
    skipInvalidRows: false,
    ignoreUnknownValues: false,
    rows: input.rows.map((row, index) => {
      const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8')
      if (rowBytes > MAX_ROW_BYTES) {
        throw new Error(
          `BigQuery row at index ${index} is ${rowBytes} bytes, exceeds the ${MAX_ROW_BYTES}-byte per-row limit`
        )
      }
      return {
        insertId: buildInsertId(input.metadata, index),
        json: row,
      }
    }),
  }
  const body = JSON.stringify(payload)
  const byteLength = Buffer.byteLength(body, 'utf8')
  if (byteLength > MAX_REQUEST_BYTES) {
    throw new Error(
      `BigQuery insertAll body is ${byteLength} bytes, exceeds the ${MAX_REQUEST_BYTES}-byte per-request limit`
    )
  }
  let attempt = 0
  let response: Response | undefined
  let refreshedOnce = false
  while (true) {
    attempt++
    try {
      response = await postInsertAll(input, url, body)
      /** A 401 retry doesn't count against the 5xx/429 budget — token refresh is a one-shot recovery. */
      if (response.status === 401 && !refreshedOnce) {
        refreshedOnce = true
        logger.debug('BigQuery returned 401; refreshing access token and retrying once')
        /** Drain the 401 body before discarding so undici can return the socket to the keep-alive pool. */
        await response.text().catch(() => '')
        response = await postInsertAll(input, url, body, true)
      }
      if (!RETRYABLE_STATUSES.has(response.status)) break
      if (attempt >= MAX_RETRY_ATTEMPTS) break
      const retryAfterHeaderMs = parseRetryAfter(response.headers.get('retry-after'))
      const retryAfterMs = backoffWithJitter(attempt, retryAfterHeaderMs, {
        baseMs: BASE_RETRY_DELAY_MS,
      })
      logger.warn('BigQuery insertAll transient error; retrying', {
        status: response.status,
        attempt,
        retryAfterMs,
      })
      /** Drain the body so the keep-alive connection can be reused. */
      await response.text().catch(() => '')
      await sleepUntilAborted(retryAfterMs, input.signal)
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    } catch (error) {
      /**
       * Connection-level failures (DNS, socket reset, timeout) never produce
       * a Response — treat them like 5xx and retry with backoff. Re-throw
       * aborts unwrapped so callers see the cancellation reason.
       */
      if (input.signal.aborted) throw input.signal.reason ?? error
      if (attempt >= MAX_RETRY_ATTEMPTS) throw error
      const retryAfterMs = backoffWithJitter(attempt, null, { baseMs: BASE_RETRY_DELAY_MS })
      logger.warn('BigQuery insertAll network error; retrying', {
        attempt,
        retryAfterMs,
        error: toError(error).message,
      })
      await sleepUntilAborted(retryAfterMs, input.signal)
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    }
  }
  if (!response) throw new Error('BigQuery insertAll failed: no response')
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

  /**
   * Probes table existence, IAM access, and credential validity in a single
   * `tables.get` call. `fields=id` minimises response size — we only care
   * whether the call succeeds, not the payload.
   */
  async test({ config, credentials, signal }) {
    const account = parseServiceAccount(credentials.serviceAccountJson)
    const jwt = buildJwt(account)
    const token = await getAccessToken(jwt)
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.projectId)}/datasets/${encodeURIComponent(config.datasetId)}/tables/${encodeURIComponent(config.tableId)}?fields=id`
    const perAttempt = AbortSignal.any([signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: perAttempt,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`BigQuery probe failed (HTTP ${response.status}): ${text}`)
    }
    /** Drain the success body so undici can return the socket to the keep-alive pool. */
    await response.text().catch(() => '')
  },

  openSession({ config, credentials }) {
    const account = parseServiceAccount(credentials.serviceAccountJson)
    const jwt = buildJwt(account)
    return {
      async deliver({ body, metadata, signal }) {
        const rows = parseNdjsonObjects(body, { requireObject: true }) as Record<string, unknown>[]
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
