import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { z } from 'zod'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  sentinelConfigSchema,
  sentinelCredentialsSchema,
} from '@/lib/data-drains/destinations/sentinel-config'
import { parseNdjsonObjects } from '@/lib/data-drains/destinations/utils'
import type { DrainDestination } from '@/lib/data-drains/types'

const MAX_REQUEST_BYTES = 1_000_000
const MAX_DATA_BYTES = 64_000
const MAX_ATTEMPTS = 4
const MAX_RETRY_DELAY_MS = 60_000
const TOKEN_REFRESH_MARGIN_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 64 * 1024

type SentinelConfig = z.infer<typeof sentinelConfigSchema>
type SentinelCredentials = z.infer<typeof sentinelCredentialsSchema>

const tokenResponseSchema = z.object({
  access_token: z
    .string()
    .min(1)
    .max(32_768)
    .regex(/^[^\r\n\0]+$/),
  expires_in: z.number().int().positive().max(86_400),
})

interface SentinelEvent {
  TimeGenerated: string
  Source: string
  RecordId: string
  DrainId: string
  RunId: string
  Data: Record<string, unknown>
}

function createIngestionClient(config: SentinelConfig, credentials: SentinelCredentials) {
  const endpoint = new URL(config.endpoint).origin
  const ingestionUrl = `${endpoint}/dataCollectionRules/${config.ruleId}/streams/${config.streamName}?api-version=2023-01-01`
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`
  let ingestionIP: string | undefined
  let tokenIP: string | undefined
  let token: { value: string; expiresAt: number } | undefined

  async function request(
    target: 'ingestion' | 'token',
    body: string,
    signal: AbortSignal,
    accessToken?: string
  ) {
    signal.throwIfAborted()
    const url = target === 'ingestion' ? ingestionUrl : tokenUrl
    let resolvedIP = target === 'ingestion' ? ingestionIP : tokenIP
    if (!resolvedIP) {
      const validation = await validateUrlWithDNS(url, 'endpoint', 'configuredEndpoint')
      if (!validation.isValid) throw new Error(validation.error)
      resolvedIP = validation.resolvedIP
      if (target === 'ingestion') ingestionIP = resolvedIP
      else tokenIP = resolvedIP
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      signal.throwIfAborted()
      let retryAfterMs: number | null = null
      let response: Awaited<ReturnType<typeof secureFetchWithPinnedIP>> | undefined
      try {
        response = await secureFetchWithPinnedIP(url, resolvedIP, {
          profile: 'configuredEndpoint',
          method: 'POST',
          body,
          headers: {
            'Content-Type':
              target === 'token' ? 'application/x-www-form-urlencoded' : 'application/json',
            'User-Agent': 'Sim-DataDrain/1.0',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          signal,
          timeout: REQUEST_TIMEOUT_MS,
          maxResponseBytes: MAX_RESPONSE_BYTES,
          maxRedirects: 0,
        })
      } catch {
        signal.throwIfAborted()
        if (attempt === MAX_ATTEMPTS)
          throw new Error(`Sentinel ${target} request failed after retries`)
      }
      if (response) {
        if (response.status === (target === 'token' ? 200 : 204)) return response
        if (response.status === 401 && target === 'ingestion') return response
        if (response.status !== 408 && response.status !== 429 && response.status < 500) {
          throw new Error(`Sentinel ${target} responded with HTTP ${response.status}`)
        }
        retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Number.MAX_SAFE_INTEGER)
        if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_DELAY_MS) {
          throw new Error(
            `Sentinel ${target} responded with HTTP ${response.status}; Retry-After exceeds the 60-second retry window. Retry the drain later.`
          )
        }
        if (attempt === MAX_ATTEMPTS)
          throw new Error(`Sentinel ${target} responded with HTTP ${response.status} after retries`)
      }
      await interruptibleSleep(
        backoffWithJitter(attempt, retryAfterMs, { maxMs: MAX_RETRY_DELAY_MS }),
        signal
      )
    }
    throw new Error(`Sentinel ${target} request failed`)
  }

  async function getToken(signal: AbortSignal) {
    if (token && token.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) return token.value
    const startedAt = Date.now()
    const response = await request(
      'token',
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://monitor.azure.com//.default',
      }).toString(),
      signal
    )
    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success)
      throw new Error('Sentinel authentication returned an invalid token response')
    token = {
      value: parsed.data.access_token,
      expiresAt: startedAt + parsed.data.expires_in * 1000,
    }
    return token.value
  }

  return {
    async send(body: string, signal: AbortSignal) {
      let response = await request('ingestion', body, signal, await getToken(signal))
      if (response.status === 401) {
        token = undefined
        response = await request('ingestion', body, signal, await getToken(signal))
        if (response.status === 401)
          throw new Error(
            'Sentinel ingestion responded with HTTP 401 after refreshing authentication'
          )
      }
    },
    clear() {
      token = undefined
    },
    locator: ingestionUrl,
  }
}

export const sentinelDestination: DrainDestination<SentinelConfig, SentinelCredentials> = {
  type: 'sentinel',
  displayName: 'Microsoft Sentinel',
  configSchema: sentinelConfigSchema,
  credentialsSchema: sentinelCredentialsSchema,

  async test({ config, credentials, signal }) {
    const client = createIngestionClient(
      sentinelConfigSchema.parse(config),
      sentinelCredentialsSchema.parse(credentials)
    )
    const probe: SentinelEvent = {
      TimeGenerated: new Date().toISOString(),
      Source: 'connection_test',
      RecordId: generateId(),
      DrainId: '',
      RunId: '',
      Data: { sim: 'connection-test' },
    }
    try {
      await client.send(JSON.stringify([probe]), signal)
    } finally {
      client.clear()
    }
  },

  openSession({ config, credentials }) {
    const client = createIngestionClient(
      sentinelConfigSchema.parse(config),
      sentinelCredentialsSchema.parse(credentials)
    )
    return {
      async deliver({ body, metadata, signal, acknowledge }) {
        signal.throwIfAborted()
        const entries = parseNdjsonObjects(body, { requireObject: true }).map((row, index) => {
          if (!isRecordLike(row) || typeof row.id !== 'string' || !row.id) {
            throw new Error(`Sentinel row at index ${index} must have a source record id`)
          }
          if (Buffer.byteLength(JSON.stringify(row), 'utf8') > MAX_DATA_BYTES) {
            throw new Error(
              `Sentinel row at index ${index} exceeds the ${MAX_DATA_BYTES}-byte Data field limit; use an object-storage drain for larger records`
            )
          }
          const event: SentinelEvent = {
            TimeGenerated: metadata.runStartedAt.toISOString(),
            Source: metadata.source,
            RecordId: row.id,
            DrainId: metadata.drainId,
            RunId: metadata.runId,
            Data: row,
          }
          const json = JSON.stringify(event)
          const bytes = Buffer.byteLength(json, 'utf8')
          if (bytes + 2 > MAX_REQUEST_BYTES)
            throw new Error(`Sentinel row at index ${index} exceeds the request limit`)
          return { json, bytes }
        })
        let batch: string[] = []
        let batchBytes = 2
        let batchIndex = 0
        let locator = client.locator
        const sendBatch = async () => {
          await client.send(`[${batch.join(',')}]`, signal)
          locator = `${client.locator}#${metadata.runId}-${metadata.sequence}-${batchIndex}`
          await acknowledge?.({ locator, rowCount: batch.length })
          batch = []
          batchBytes = 2
          batchIndex++
        }
        for (const entry of entries) {
          if (batchBytes + entry.bytes + (batch.length ? 1 : 0) > MAX_REQUEST_BYTES)
            await sendBatch()
          batchBytes += entry.bytes + (batch.length ? 1 : 0)
          batch.push(entry.json)
        }
        if (batch.length) await sendBatch()
        return { locator }
      },
      async close() {
        client.clear()
      },
    }
  },
}
