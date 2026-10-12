import { createHash } from 'node:crypto'
import type { db } from '@sim/db'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { enqueueOutboxEvent, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { SIM_AGENT_API_URL } from '@/lib/mothership/constants'
import { MemoryCleanupInput, MemoryCleanupResult } from '@/lib/mothership/generated/memory-access'
import { MEMORY_CLEANUP_EVENT } from '@/lib/mothership/memories/cleanup-event'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipSourceEnvHeaders } from '@/lib/mothership/server/agent-url'

const cleanupPayloadSchema = z.strictObject({
  request: MemoryCleanupInput,
  baseUrl: z.url(),
  credentialFingerprint: z.string().nullable(),
  sourceHeaders: z.record(z.string(), z.string()),
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

function credentialFingerprint(): string | null {
  return env.COPILOT_API_KEY ? createHash('sha256').update(env.COPILOT_API_KEY).digest('hex') : null
}

/** Captures configured routes before deletion; notes can outlive a user's environment selection. */
export async function enqueueMemoryCleanup(
  executor: Pick<typeof db, 'insert'>,
  targets: MemoryCleanupInput['target'][]
): Promise<void> {
  const fingerprint = credentialFingerprint()
  const sourceHeaders = getMothershipSourceEnvHeaders()
  for (const baseUrl of destinations()) {
    for (const target of targets) {
      await enqueueOutboxEvent(
        executor,
        MEMORY_CLEANUP_EVENT,
        cleanupPayloadSchema.parse({
          request: { version: 1, target },
          baseUrl,
          credentialFingerprint: fingerprint,
          sourceHeaders,
        })
      )
    }
  }
}

export const memoryCleanupOutboxHandlers = {
  [MEMORY_CLEANUP_EVENT]: async (rawPayload, context) => {
    const payload = cleanupPayloadSchema.parse(rawPayload)
    if (
      !payload.credentialFingerprint ||
      payload.credentialFingerprint !== credentialFingerprint()
    ) {
      throw new Error('Memory cleanup credential binding changed; operator reconciliation required')
    }
    if (
      !destinations().includes(payload.baseUrl) ||
      JSON.stringify(payload.sourceHeaders) !== JSON.stringify(getMothershipSourceEnvHeaders())
    ) {
      throw new Error(
        'Memory cleanup destination binding changed; operator reconciliation required'
      )
    }
    const response = await fetchGo(`${payload.baseUrl}/api/memories/cleanup`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify(payload.request),
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Memory cleanup failed (${response.status})`)
    MemoryCleanupResult.parse(await response.json())
  },
} satisfies OutboxHandlerRegistry
