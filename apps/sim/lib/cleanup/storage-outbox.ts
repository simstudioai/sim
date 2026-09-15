import { workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, inArray } from 'drizzle-orm'
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
const bindingSchema = z.object({
  id: z.string().min(1),
  context: z.string().min(1),
  contentUpdatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
})
const payloadSchema = z
  .object({
    files: z
      .array(z.object({ key: z.string().min(1), bindings: z.array(bindingSchema) }))
      .min(1)
      .max(500),
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

const bindingColumns = {
  id: workspaceFiles.id,
  key: workspaceFiles.key,
  context: workspaceFiles.context,
  contentUpdatedAt: workspaceFiles.contentUpdatedAt,
  deletedAt: workspaceFiles.deletedAt,
}
function identity(row: {
  id: string
  context: string
  contentUpdatedAt: Date
  deletedAt: Date | null
}): z.infer<typeof bindingSchema> {
  return {
    id: row.id,
    context: row.context,
    contentUpdatedAt: row.contentUpdatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

function handler(onResult?: (deleted: number, failed: number) => Promise<void>): OutboxHandler {
  return async (rawPayload, context) => {
    const payload = payloadSchema.parse(rawPayload)
    const { StorageService } = await import('@/lib/uploads')
    for (const file of payload.files) {
      context.signal.throwIfAborted()
      let deleted: boolean
      try {
        deleted = await cleanupQuery(async (tx) => {
          // The lock coordinates restoration of this generation with the bounded storage call.
          const current = await tx
            .select(bindingColumns)
            .from(workspaceFiles)
            .where(eq(workspaceFiles.key, file.key))
            .orderBy(asc(workspaceFiles.id))
            .for('update')
          const expected = new Map(file.bindings.map((binding) => [binding.id, binding]))
          if (
            current.length !== expected.size ||
            current.some((row) => {
              const binding = expected.get(row.id)
              const actual = identity(row)
              return (
                !binding ||
                actual.context !== binding.context ||
                actual.context !== payload.context ||
                actual.contentUpdatedAt !== binding.contentUpdatedAt ||
                actual.deletedAt !== binding.deletedAt ||
                (!payload.tombstoneFiles && actual.deletedAt === null)
              )
            })
          )
            return false

          const signal = AbortSignal.any([context.signal, AbortSignal.timeout(15_000)])
          await StorageService.deleteFile({ key: file.key, context: payload.context, signal })
          signal.throwIfAborted()
          if (payload.tombstoneFiles && current.length) {
            await tx
              .update(workspaceFiles)
              .set({ deletedAt: new Date() })
              .where(
                and(
                  eq(workspaceFiles.key, file.key),
                  inArray(
                    workspaceFiles.id,
                    current.map((row) => row.id)
                  )
                )
              )
          }
          return true
        })
      } catch (error) {
        await onResult?.(0, 1)
        throw error
      }
      if (deleted) await onResult?.(1, 0)
    }
  }
}

export const retentionStorageOutboxHandlers = { [EVENT]: handler() }

/** Snapshot metadata generations in the transaction that deletes or claims their roots. */
export async function enqueueRetentionStorageCleanup(
  tx: Pick<CleanupTransaction, 'insert' | 'select'>,
  keys: string[],
  context: StorageContext,
  batchSize: number,
  tombstoneFiles = false
): Promise<string[]> {
  const events: string[] = []
  for (const batch of chunkArray([...new Set(keys)], batchSize)) {
    const bindings = await tx
      .select(bindingColumns)
      .from(workspaceFiles)
      .where(inArray(workspaceFiles.key, batch))
      .orderBy(asc(workspaceFiles.id))
      .for('update')
    const files = batch.map((key) => ({
      key,
      bindings: bindings.filter((row) => row.key === key).map(identity),
    }))
    const payload = payloadSchema.parse({ files, context, tombstoneFiles })
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
