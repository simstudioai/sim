import { workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { type BoundedCleanup, type CleanupTransaction, cleanupQuery } from '@/lib/cleanup/bounded'
import type { CleanupType } from '@/lib/cleanup/bounded-types'
import {
  enqueueOutboxEvent,
  type OutboxHandler,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import type { StorageContext } from '@/lib/uploads/shared/types'

const EVENT = 'retention.storage.cleanup'
const payloadSchema = z
  .object({
    keys: z.array(z.string().min(1)).min(1).max(500),
    context: z.enum([
      'knowledge-base',
      'chat',
      'copilot',
      'mothership',
      'execution',
      'workspace',
      'table-import',
      'profile-pictures',
      'og-images',
      'logs',
      'workspace-logos',
      'organization-logos',
    ]),
    tombstoneFiles: z.boolean(),
  })
  .strict()

function handler(onResult?: (deleted: number, failed: number) => Promise<void>): OutboxHandler {
  return async (rawPayload, context) => {
    const payload = payloadSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const { StorageService } = await import('@/lib/uploads')
    let result: Awaited<ReturnType<typeof StorageService.deleteFiles>>
    try {
      result = await StorageService.deleteFiles(payload.keys, payload.context)
    } catch (error) {
      await onResult?.(0, payload.keys.length)
      throw error
    }
    await onResult?.(result.deleted, result.failed.length)
    if (result.failed.length > 0) throw new Error('Retention storage deletions failed')
    context.signal.throwIfAborted()
    if (payload.tombstoneFiles) {
      await cleanupQuery(async (tx) => {
        await tx
          .update(workspaceFiles)
          .set({ deletedAt: new Date() })
          .where(and(inArray(workspaceFiles.key, payload.keys), isNull(workspaceFiles.deletedAt)))
      })
    }
  }
}

export const retentionStorageOutboxHandlers = { [EVENT]: handler() }

/** Persist immutable keys in the same transaction that deletes or claims their roots. */
export async function enqueueRetentionStorageCleanup(
  tx: Pick<CleanupTransaction, 'insert'>,
  keys: string[],
  context: StorageContext,
  batchSize: number,
  tombstoneFiles = false
): Promise<string[]> {
  const events: string[] = []
  for (const batch of chunkArray([...new Set(keys)], batchSize)) {
    const payload = payloadSchema.parse({ keys: batch, context, tombstoneFiles })
    events.push(await enqueueOutboxEvent(tx, EVENT, payload, { maxAttempts: 48 }))
  }
  return events
}

/** Attempt only this batch's durable events; the existing outbox worker retries failures. */
export async function processRetentionStorageCleanup(
  control: BoundedCleanup,
  type: CleanupType,
  eventIds: string[]
): Promise<void> {
  const handlers = { [EVENT]: handler((deleted, failed) => control.files(type, deleted, failed)) }
  for (const eventId of eventIds) {
    const result = await processOutboxEventById(eventId, handlers)
    if (result !== 'completed')
      throw new Error(`Retention storage cleanup is incomplete: ${result}`)
  }
}
