import { db } from '@sim/db'
import { copilotChats, document, organization, workspaceFiles } from '@sim/db/schema'
import { describeError, toError } from '@sim/utils/errors'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { cleanupCopilotBackend } from '@/lib/cleanup/chat-cleanup'
import { env } from '@/lib/core/config/env'
import { enqueueOutboxEvent, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbTransaction } from '@/lib/db/types'
import { deleteFile } from '@/lib/uploads/core/storage-service'

export const ORGANIZATION_RESOURCE_CLEANUP_EVENT = 'organization.resources.cleanup'
const CLEANUP_BATCH_SIZE = 100
const FILE_DELETE_CONCURRENCY = 10

const organizationResourceCleanupSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('files'),
      organizationId: z.string().min(1).max(255),
      storageKeys: z.array(z.string().min(1).max(8192)).min(1).max(CLEANUP_BATCH_SIZE),
    })
    .strict(),
  z
    .object({
      kind: z.literal('chats'),
      organizationId: z.string().min(1).max(255),
      chatIds: z.array(z.string().uuid()).min(1).max(CLEANUP_BATCH_SIZE),
    })
    .strict(),
])

/**
 * Captures canonical bindings before the org FK cascade removes them. The org
 * row lock excludes new direct resources; a rebound resource is checked again
 * by the worker. Each keyset page becomes its own bounded outbox event in the
 * caller's delete transaction, so rollback cannot leave cleanup work behind.
 */
export async function enqueueOrganizationResourceCleanup(
  tx: DbTransaction,
  organizationId: string
): Promise<void> {
  const [owner] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for('update')
    .limit(1)
  if (!owner) throw new Error('Organization no longer exists')

  let fileCursor: string | undefined
  while (true) {
    const files = await tx
      .select({ id: workspaceFiles.id, key: workspaceFiles.key })
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.organizationId, organizationId),
          isNull(workspaceFiles.workspaceId),
          eq(workspaceFiles.context, 'knowledge-base'),
          fileCursor ? gt(workspaceFiles.id, fileCursor) : undefined
        )
      )
      .orderBy(asc(workspaceFiles.id))
      .limit(CLEANUP_BATCH_SIZE)
    if (files.length === 0) break
    await enqueueOutboxEvent(
      tx,
      ORGANIZATION_RESOURCE_CLEANUP_EVENT,
      organizationResourceCleanupSchema.parse({
        kind: 'files',
        organizationId,
        storageKeys: files.map(({ key }) => key),
      })
    )
    fileCursor = files[files.length - 1].id
    if (files.length < CLEANUP_BATCH_SIZE) break
  }

  let chatCursor: string | undefined
  while (true) {
    const chats = await tx
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.organizationId, organizationId),
          isNull(copilotChats.workspaceId),
          chatCursor ? gt(copilotChats.id, chatCursor) : undefined
        )
      )
      .orderBy(asc(copilotChats.id))
      .limit(CLEANUP_BATCH_SIZE)
    if (chats.length === 0) break
    await enqueueOutboxEvent(
      tx,
      ORGANIZATION_RESOURCE_CLEANUP_EVENT,
      organizationResourceCleanupSchema.parse({
        kind: 'chats',
        organizationId,
        chatIds: chats.map(({ id }) => id),
      })
    )
    chatCursor = chats[chats.length - 1].id
    if (chats.length < CLEANUP_BATCH_SIZE) break
  }
}

export const organizationResourceCleanupOutboxHandlers = {
  [ORGANIZATION_RESOURCE_CLEANUP_EVENT]: async (rawPayload, context) => {
    const payload = organizationResourceCleanupSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const [owner] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, payload.organizationId))
      .limit(1)
    if (owner) return

    if (payload.kind === 'chats') {
      const surviving = await db
        .select({ id: copilotChats.id })
        .from(copilotChats)
        .where(inArray(copilotChats.id, payload.chatIds))
      const survivingIds = new Set(surviving.map(({ id }) => id))
      const deletedIds = payload.chatIds.filter((id) => !survivingIds.has(id))
      if (deletedIds.length === 0) return
      context.signal.throwIfAborted()
      if (!env.COPILOT_API_KEY) throw new Error('Copilot cleanup is not configured')
      const result = await cleanupCopilotBackend(
        deletedIds,
        `OrganizationCleanup:${context.eventId}`
      )
      if (result.failed > 0) throw new Error('Organization chat backend cleanup failed')
      return
    }

    const keys = payload.storageKeys
    const [bindings, documents] = await Promise.all([
      db
        .selectDistinct({ key: workspaceFiles.key })
        .from(workspaceFiles)
        .where(inArray(workspaceFiles.key, keys)),
      db
        .selectDistinct({ key: document.storageKey })
        .from(document)
        .where(inArray(document.storageKey, keys)),
    ])
    const retainedKeys = new Set([...bindings, ...documents].map(({ key }) => key))
    const failures = await mapWithConcurrency(keys, FILE_DELETE_CONCURRENCY, async (key) => {
      context.signal.throwIfAborted()
      if (retainedKeys.has(key)) return
      try {
        await deleteFile({ key, context: 'knowledge-base' })
      } catch (error) {
        if (describeError(error).code !== 'ENOENT') return toError(error)
      }
    })
    const failure = failures.find((error) => error !== undefined)
    if (failure) throw failure
  },
} satisfies OutboxHandlerRegistry
