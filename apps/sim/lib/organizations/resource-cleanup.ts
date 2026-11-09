import { db } from '@sim/db'
import { copilotChats, organization, workspaceFiles } from '@sim/db/schema'
import { describeError, toError } from '@sim/utils/errors'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { cleanupCopilotBackend } from '@/lib/cleanup/chat-cleanup'
import { env } from '@/lib/core/config/env'
import { enqueueOutboxEvent, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbTransaction } from '@/lib/db/types'
import { enqueueMemoryCleanup } from '@/lib/mothership/memories/cleanup-outbox'
import {
  CLEANUP_BATCH_SIZE,
  enqueueFilePages,
  enqueueOrganizationStoredObjectCleanup,
  ORGANIZATION_RESOURCE_CLEANUP_EVENT,
  organizationResourceCleanupSchema,
} from '@/lib/organizations/resource-cleanup-event'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { createStorageReferenceGuard } from '@/lib/users/storage-reference-guard'
import { toDisposableStorageObject } from '@/lib/users/storage-sweep'

const FILE_DELETE_CONCURRENCY = 10

/**
 * Captures canonical bindings before the org FK cascade removes them: every stored object of the
 * organization's Knowledge files and of its chats' Copilot uploads, the documents of its knowledge
 * bases, and its chats. The org row lock excludes new
 * direct resources; a rebound or reused object is kept by the worker's reference check. Each
 * keyset page becomes its own bounded outbox event in the caller's delete transaction, so rollback
 * cannot leave cleanup work behind. The members' private Mothership memory in the organization,
 * memory spaces included, is erased the same way.
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

  await enqueueOrganizationStoredObjectCleanup(tx, organizationId)
  const organizationChats = tx
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(and(eq(copilotChats.organizationId, organizationId), isNull(copilotChats.workspaceId)))
  await enqueueFilePages(
    tx,
    organizationId,
    and(isNull(workspaceFiles.workspaceId), inArray(workspaceFiles.chatId, organizationChats))
  )

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

  await enqueueMemoryCleanup(tx, [{ kind: 'organization', organizationId }])
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

    const objects =
      payload.kind === 'files'
        ? payload.storageKeys.map((key) => ({ key, context: 'knowledge-base' }))
        : payload.objects
    const disposable = objects.flatMap(({ key, context }) => {
      const object = toDisposableStorageObject(key, context)
      return object ? [object] : []
    })
    const referenced = await createStorageReferenceGuard()(disposable.map(({ key }) => key))
    const failures = await mapWithConcurrency(
      disposable,
      FILE_DELETE_CONCURRENCY,
      async ({ key, context: storageContext }) => {
        context.signal.throwIfAborted()
        if (referenced.has(key)) return
        try {
          await deleteFile({ key, context: storageContext })
        } catch (error) {
          if (describeError(error).code !== 'ENOENT') return toError(error)
        }
      }
    )
    const failure = failures.find((error) => error !== undefined)
    if (failure) throw failure
  },
} satisfies OutboxHandlerRegistry
