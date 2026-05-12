import { gzipSync } from 'node:zlib'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { z } from 'zod'
import {
  backoffWithJitter,
  parseNdjsonObjects,
  parseRetryAfter,
  sleepUntilAborted,
} from '@/lib/data-drains/destinations/utils'
import type { DeliveryMetadata, DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainDatadogDestination')

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
const MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024
const MAX_WIRE_BYTES = 6 * 1024 * 1024
const MAX_ENTRY_BYTES = 1024 * 1024
const MAX_ENTRIES_PER_REQUEST = 1000
const GZIP_THRESHOLD_BYTES = 1024

/**
 * Datadog tag format: comma-separated `key:value` pairs. Each key must start
 * with a letter and contain only [A-Za-z0-9_:./-]. Validating here so the
 * `ddtags` header we emit can't be mangled by user-supplied free-form input.
 */
const DATADOG_TAG_PAIR_RE = /^[A-Za-z][A-Za-z0-9_./-]*:[^,\s][^,]*$/

const datadogConfigSchema = z.object({
  site: z.enum(DATADOG_SITES),
  service: z.string().min(1).max(100).optional(),
  tags: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (v) =>
        v
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .every((t) => DATADOG_TAG_PAIR_RE.test(t)),
      { message: 'tags must be comma-separated key:value pairs' }
    )
    .optional(),
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

function buildEntries(
  rows: unknown[],
  config: DatadogDestinationConfig,
  metadata: DeliveryMetadata
): DatadogLogEntry[] {
  const ddtags = [
    `sim_drain_id:${metadata.drainId}`,
    `sim_run_id:${metadata.runId}`,
    `sim_source:${metadata.source}`,
    ...(config.tags ? [config.tags] : []),
  ].join(',')
  const service = config.service ?? 'sim'
  return rows.map((row) => {
    const attrs = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}
    let message: string
    if (typeof row === 'string') {
      message = row
    } else if (typeof attrs.message === 'string') {
      message = attrs.message
    } else {
      message = JSON.stringify(row)
    }
    /**
     * Spread user attributes first, then force all four reserved fields the
     * drain owns: `ddsource`, `service`, `ddtags`, and `message`. Per
     * https://docs.datadoghq.com/logs/log_configuration/pipelines/#service-and-source,
     * Datadog uses `service` + `ddsource` to pick the processing pipeline, so
     * letting a row field clobber them would silently re-route a drain.
     */
    return {
      ...attrs,
      ddsource: 'sim',
      service,
      ddtags,
      message,
    }
  })
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

interface PreparedBody {
  body: Uint8Array | string
  headers: Record<string, string>
  wireBytes: number
  rawBytes: number
}

interface PostInput {
  url: string
  prepared: PreparedBody
  signal: AbortSignal
}

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
        // double-cast-allowed: Uint8Array is a valid runtime BodyInit but the DOM lib types only enumerate Blob/FormData/string/etc.
        body: body as unknown as BodyInit,
        headers,
        signal: perAttempt,
      })
    } catch (error) {
      lastError = error
      logger.debug('Datadog request failed', { attempt, error: toError(error).message })
    }
    if (response) {
      if (response.ok) {
        /** Drain the success body so undici can return the socket to the keep-alive pool. Headers remain readable after consumption. */
        await response.text().catch(() => '')
        return response
      }
      if (!isRetryableStatus(response.status)) {
        const text = await response.text().catch(() => '')
        throw new Error(`Datadog responded with HTTP ${response.status}: ${text}`)
      }
      lastError = new Error(`Datadog responded with HTTP ${response.status}`)
      retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      /** Drain the retryable response body so undici can return the socket to the keep-alive pool. */
      await response.text().catch(() => '')
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
        const rows = parseNdjsonObjects(body)
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
        if (prepared.rawBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new Error(
            `Datadog payload is ${prepared.rawBytes} bytes uncompressed, exceeds the ${MAX_UNCOMPRESSED_BYTES}-byte per-request limit`
          )
        }
        if (prepared.wireBytes > MAX_WIRE_BYTES) {
          throw new Error(
            `Datadog payload is ${prepared.wireBytes} bytes on the wire, exceeds the ${MAX_WIRE_BYTES}-byte defensive wire-size cap`
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
