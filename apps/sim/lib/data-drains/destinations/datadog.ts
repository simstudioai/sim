import { gzipSync } from 'node:zlib'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { z } from 'zod'
import {
  backoffWithJitter,
  parseRetryAfter,
  sleepUntilAborted,
} from '@/lib/data-drains/destinations/utils'
import type { DeliveryMetadata, DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainDatadogDestination')

/**
 * Datadog logs intake sites. Maps the user's selection to the host of the
 * `http-intake.logs.<host>` endpoint. Source:
 * https://docs.datadoghq.com/getting_started/site/
 */
const DATADOG_SITES = ['us1', 'us3', 'us5', 'eu1', 'ap1', 'ap2', 'gov'] as const

type DatadogSite = (typeof DATADOG_SITES)[number]

const SITE_HOSTS: Record<DatadogSite, string> = {
  us1: 'datadoghq.com',
  us3: 'us3.datadoghq.com',
  us5: 'us5.datadoghq.com',
  eu1: 'datadoghq.eu',
  ap1: 'ap1.datadoghq.com',
  ap2: 'ap2.datadoghq.com',
  gov: 'ddog-gov.com',
}

const MAX_ATTEMPTS = 4
const PER_ATTEMPT_TIMEOUT_MS = 30_000
/**
 * Datadog v2 logs intake limits: 5 MB uncompressed per request, 6 MB compressed
 * (we enforce both since gzip can hide a too-large body), 1 MB per entry, 1000
 * entries per request. https://docs.datadoghq.com/api/latest/logs/
 */
const MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024
const MAX_COMPRESSED_BYTES = 6 * 1024 * 1024
const MAX_ENTRY_BYTES = 1024 * 1024
const MAX_ENTRIES_PER_REQUEST = 1000
/** Compress payloads above this threshold; gzip overhead isn't worth it on small bodies. */
const GZIP_THRESHOLD_BYTES = 1024

const datadogConfigSchema = z.object({
  site: z.enum(DATADOG_SITES),
  /** Static `service` field on every emitted log entry. Defaults to `sim`. */
  service: z.string().min(1).max(100).optional(),
  /** Static `ddtags` appended to every entry (comma-separated). */
  tags: z.string().max(1024).optional(),
})

const datadogCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
})

export type DatadogDestinationConfig = z.infer<typeof datadogConfigSchema>
export type DatadogDestinationCredentials = z.infer<typeof datadogCredentialsSchema>

interface DatadogLogEntry {
  ddsource: string
  service: string
  ddtags: string
  message: string
  [attribute: string]: unknown
}

function buildEndpoint(site: DatadogSite): string {
  return `https://http-intake.logs.${SITE_HOSTS[site]}/api/v2/logs`
}

/**
 * Parses NDJSON body back into row objects. Skips empty trailing lines so the
 * final newline written by sources doesn't produce a phantom entry.
 */
function parseNdjson(body: Buffer): unknown[] {
  const text = body.toString('utf8')
  const rows: unknown[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0) continue
    try {
      rows.push(JSON.parse(line))
    } catch (error) {
      throw new Error(`NDJSON parse failed at line ${i}: ${toError(error).message}`)
    }
  }
  return rows
}

function buildEntries(
  rows: unknown[],
  config: DatadogDestinationConfig,
  metadata: DeliveryMetadata
): DatadogLogEntry[] {
  const baseTags = [
    `sim_drain_id:${metadata.drainId}`,
    `sim_run_id:${metadata.runId}`,
    `sim_source:${metadata.source}`,
  ]
  if (config.tags) baseTags.push(config.tags)
  const ddtags = baseTags.join(',')
  const service = config.service ?? 'sim'
  return rows.map((row) => {
    const attrs = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}
    // Datadog v2 logs intake auto-indexes top-level non-reserved keys as
    // attributes — there is no `attributes` envelope. Spread row fields first
    // so reserved fields (ddsource/service/ddtags/message) always win.
    return {
      ...attrs,
      ddsource: 'sim',
      service,
      ddtags,
      message: typeof row === 'string' ? row : JSON.stringify(row),
    }
  })
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

interface PreparedBody {
  body: Uint8Array | string
  headers: Record<string, string>
  /** On-the-wire (post-gzip) size — what Datadog measures against its compressed limit. */
  wireBytes: number
  /** Uncompressed payload size — what Datadog measures against its uncompressed limit. */
  rawBytes: number
}

interface PostInput {
  url: string
  prepared: PreparedBody
  signal: AbortSignal
}

/**
 * Builds the request body and headers, applying gzip compression for payloads
 * above {@link GZIP_THRESHOLD_BYTES}. Returns the wire body (Buffer or string)
 * along with the headers describing it. Both raw and wire sizes are returned
 * so callers can enforce Datadog's 5 MB uncompressed / 6 MB compressed limits.
 */
function buildRequestBody(payload: string, apiKey: string): PreparedBody {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'DD-API-KEY': apiKey,
    Accept: 'application/json',
    'User-Agent': 'sim-data-drain/1.0',
  }
  const rawBytes = Buffer.byteLength(payload, 'utf8')
  if (rawBytes > GZIP_THRESHOLD_BYTES) {
    const compressed = gzipSync(payload)
    headers['Content-Encoding'] = 'gzip'
    // Re-wrap as a plain Uint8Array view so the fetch BodyInit overload matches.
    const view = new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength)
    return { body: view, headers, wireBytes: view.byteLength, rawBytes }
  }
  return { body: payload, headers, wireBytes: rawBytes, rawBytes }
}

async function postWithRetries(input: PostInput): Promise<Response> {
  const { body, headers } = input.prepared
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    const perAttempt = AbortSignal.any([input.signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
    let retryAfterMs: number | null = null
    let response: Response | undefined
    try {
      response = await fetch(input.url, {
        method: 'POST',
        // double-cast-allowed: Uint8Array is a valid runtime BodyInit (per the fetch spec) but the DOM lib types in use here only enumerate Blob/FormData/string/etc.
        body: body as unknown as BodyInit,
        headers,
        signal: perAttempt,
      })
    } catch (error) {
      lastError = error
      logger.debug('Datadog request failed', { attempt, error: toError(error).message })
    }
    if (response) {
      if (response.ok) return response
      if (!isRetryableStatus(response.status)) {
        const text = await response.text().catch(() => '')
        throw new Error(`Datadog responded with HTTP ${response.status}: ${text}`)
      }
      lastError = new Error(`Datadog responded with HTTP ${response.status}`)
      retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleepUntilAborted(backoffWithJitter(attempt, retryAfterMs), input.signal)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Datadog delivery failed after retries')
}

export const datadogDestination: DrainDestination<
  DatadogDestinationConfig,
  DatadogDestinationCredentials
> = {
  type: 'datadog',
  displayName: 'Datadog',
  configSchema: datadogConfigSchema,
  credentialsSchema: datadogCredentialsSchema,

  async test({ config, credentials, signal }) {
    const probe = [
      {
        ddsource: 'sim',
        service: config.service ?? 'sim',
        ddtags: `sim_probe:1${config.tags ? `,${config.tags}` : ''}`,
        message: 'sim-data-drain connection test',
      },
    ]
    await postWithRetries({
      url: buildEndpoint(config.site),
      prepared: buildRequestBody(JSON.stringify(probe), credentials.apiKey),
      signal,
    })
  },

  openSession({ config, credentials }) {
    const url = buildEndpoint(config.site)
    return {
      async deliver({ body, metadata, signal }) {
        const rows = parseNdjson(body)
        const entries = buildEntries(rows, config, metadata)
        if (entries.length > MAX_ENTRIES_PER_REQUEST) {
          throw new Error(
            `Datadog chunk has ${entries.length} entries, exceeds the ${MAX_ENTRIES_PER_REQUEST} per-request limit`
          )
        }
        for (let i = 0; i < entries.length; i++) {
          const entryBytes = Buffer.byteLength(JSON.stringify(entries[i]), 'utf8')
          if (entryBytes > MAX_ENTRY_BYTES) {
            throw new Error(
              `Datadog entry at index ${i} is ${entryBytes} bytes, exceeds the ${MAX_ENTRY_BYTES}-byte per-entry limit`
            )
          }
        }
        const payload = JSON.stringify(entries)
        const prepared = buildRequestBody(payload, credentials.apiKey)
        // Reject before sending so we surface a clean client-side error instead
        // of letting Datadog return a confusing HTTP 413 after decompression.
        if (prepared.rawBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new Error(
            `Datadog payload is ${prepared.rawBytes} bytes uncompressed, exceeds the ${MAX_UNCOMPRESSED_BYTES}-byte per-request limit`
          )
        }
        if (prepared.wireBytes > MAX_COMPRESSED_BYTES) {
          throw new Error(
            `Datadog payload is ${prepared.wireBytes} bytes on the wire, exceeds the ${MAX_COMPRESSED_BYTES}-byte compressed per-request limit`
          )
        }
        const response = await postWithRetries({
          url,
          prepared,
          signal,
        })
        const requestId = response.headers.get('dd-request-id') ?? null
        logger.debug('Datadog chunk delivered', {
          site: config.site,
          rows: entries.length,
          rawBytes: prepared.rawBytes,
          wireBytes: prepared.wireBytes,
        })
        return {
          locator: requestId
            ? `datadog://${config.site}#${metadata.runId}-${metadata.sequence}@${requestId}`
            : `datadog://${config.site}#${metadata.runId}-${metadata.sequence}`,
        }
      },
      async close() {},
    }
  },
}
