import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { omit } from '@sim/utils/object'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import {
  deferOutboxHandler,
  enqueueOutboxEvents,
  MAX_BULK_ENQUEUE_EVENTS,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import { SIM_AGENT_API_URL } from '@/lib/mothership/constants'
import {
  MemoryCleanupInput,
  MemoryCleanupResult,
} from '@/lib/mothership/generated/memory-notes-access'
import { MEMORY_CLEANUP_EVENT } from '@/lib/mothership/memories/cleanup-event'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import {
  getMothershipSourceEnvHeaders,
  MOTHERSHIP_SOURCE_ENV_HEADER,
} from '@/lib/mothership/server/agent-url'

const logger = createLogger('MemoryCleanup')

/** Waits for a worker or configuration that is not there yet without spending the retry budget. */
const UNAVAILABLE_RETRY_MS = 60 * 60 * 1000
/**
 * Statuses meaning the worker does not serve cleanup yet, not that this request failed: a worker
 * that predates the route answers 404 to the hosted key.
 */
const ENDPOINT_MISSING_STATUSES = new Set([404, 405, 501])
/**
 * A worker that predates the route also answers this to a self-hosted customer key, but so does a
 * worker that revoked the key for good: it waits like a missing route but spends an attempt, so a
 * revoked key dead-letters after the default attempts (about ten hours), past a worker rollout.
 */
const UNAUTHORIZED_STATUS = 401

/** Non-strict so rows enqueued with the retired `credentialFingerprint` field still parse. */
const cleanupPayloadSchema = z.object({
  request: MemoryCleanupInput,
  baseUrl: z.url(),
  sourceHeaders: z.object({
    [MOTHERSHIP_SOURCE_ENV_HEADER]: z.enum(['dev', 'staging', 'prod']).optional(),
  }),
})

function destinations(): string[] {
  return [
    ...new Set(
      [SIM_AGENT_API_URL, env.COPILOT_DEV_URL, env.COPILOT_STAGING_URL, env.COPILOT_PROD_URL]
        .filter((value): value is string => Boolean(value))
        .filter((value) => value.startsWith('https://') || value.startsWith('http://'))
        .map((value) => value.replace(/\/+$/, ''))
    ),
  ]
}

/**
 * Captures configured routes before deletion; notes can outlive a user's environment selection.
 * Without `COPILOT_API_KEY` this Sim never reached a worker, so it holds no notes to erase and
 * queues nothing rather than an event no delivery could authenticate.
 */
export async function enqueueMemoryCleanup(
  executor: Pick<typeof db, 'insert'>,
  targets: MemoryCleanupInput['target'][]
): Promise<void> {
  if (!env.COPILOT_API_KEY) return
  const sourceHeaders = getMothershipSourceEnvHeaders()
  const payloads = destinations().flatMap((baseUrl) =>
    targets.map((target) =>
      cleanupPayloadSchema.parse({ request: { version: 1, target }, baseUrl, sourceHeaders })
    )
  )
  for (const batch of chunkArray(payloads, MAX_BULK_ENQUEUE_EVENTS)) {
    await enqueueOutboxEvents(executor, MEMORY_CLEANUP_EVENT, batch)
  }
}

function waitForWorker(
  reason: string,
  eventId: string,
  { consumeAttempt = false, ...detail }: { baseUrl?: string; consumeAttempt?: boolean } = {}
) {
  logger.warn(`Memory cleanup waiting: ${reason}`, { eventId, ...detail })
  return deferOutboxHandler(reason, UNAVAILABLE_RETRY_MS, consumeAttempt)
}

/**
 * Sends the processor's current key only to a destination the processor itself configures, and
 * replays the enqueuing deployment's source env so the worker erases that deployment's notes.
 * A missing key, destination, or worker endpoint waits without consuming attempts: erasure must
 * not dead-letter while configuration or the worker rollout catches up. A rejected key waits too,
 * but within the retry budget.
 */
export const memoryCleanupOutboxHandlers = {
  [MEMORY_CLEANUP_EVENT]: async (rawPayload, context) => {
    const payload = cleanupPayloadSchema.parse(rawPayload)
    if (!env.COPILOT_API_KEY)
      return waitForWorker('COPILOT_API_KEY is not configured', context.eventId)
    if (!destinations().includes(payload.baseUrl))
      return waitForWorker('destination is not configured', context.eventId, {
        baseUrl: payload.baseUrl,
      })
    const sourceEnv = payload.sourceHeaders[MOTHERSHIP_SOURCE_ENV_HEADER]
    const response = await fetchGo(`${payload.baseUrl}/api/memories/cleanup`, {
      method: 'POST',
      headers: {
        ...omit(mothershipRequestHeaders(), [MOTHERSHIP_SOURCE_ENV_HEADER]),
        ...(sourceEnv ? { [MOTHERSHIP_SOURCE_ENV_HEADER]: sourceEnv } : {}),
      },
      body: JSON.stringify(payload.request),
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (ENDPOINT_MISSING_STATUSES.has(response.status))
        return waitForWorker(`endpoint unavailable (${response.status})`, context.eventId)
      if (response.status === UNAUTHORIZED_STATUS)
        return waitForWorker('worker rejected the key (401)', context.eventId, {
          consumeAttempt: true,
        })
      throw new Error(`Memory cleanup failed (${response.status})`)
    }
    MemoryCleanupResult.parse(await response.json())
  },
} satisfies OutboxHandlerRegistry
