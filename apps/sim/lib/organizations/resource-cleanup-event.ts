import { document, knowledgeBase, workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, gt, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'

/**
 * Queuing an organization's resource cleanup, apart from the worker that deletes them, so a
 * membership transaction that queues it does not load storage deletion.
 */

export const ORGANIZATION_RESOURCE_CLEANUP_EVENT = 'organization.resources.cleanup'

export const CLEANUP_BATCH_SIZE = 100

const organizationIdSchema = z.string().min(1).max(255)

export const organizationResourceCleanupSchema = z.discriminatedUnion('kind', [
  /** Knowledge-base keys, as events queued before objects carried their storage context name them. */
  z
    .object({
      kind: z.literal('files'),
      organizationId: organizationIdSchema,
      storageKeys: z.array(z.string().min(1).max(8192)).min(1).max(CLEANUP_BATCH_SIZE),
    })
    .strict(),
  z
    .object({
      kind: z.literal('objects'),
      organizationId: organizationIdSchema,
      objects: z
        .array(z.object({ key: z.string().min(1).max(8192), context: z.string().min(1) }).strict())
        .min(1)
        .max(CLEANUP_BATCH_SIZE),
    })
    .strict(),
  z
    .object({
      kind: z.literal('chats'),
      organizationId: organizationIdSchema,
      chatIds: z.array(z.string().uuid()).min(1).max(CLEANUP_BATCH_SIZE),
    })
    .strict(),
])

interface ObjectRow {
  key: string | null
  context: string
}

/** The worker deletes only the objects it may dispose of; the rows here name every object. */
async function enqueueObjects(tx: DbTransaction, organizationId: string, rows: ObjectRow[]) {
  const objects = rows.flatMap(({ key, context }) => (key ? [{ key, context }] : []))
  for (const chunk of chunkArray(objects, CLEANUP_BATCH_SIZE)) {
    await enqueueOutboxEvent(
      tx,
      ORGANIZATION_RESOURCE_CLEANUP_EVENT,
      organizationResourceCleanupSchema.parse({ kind: 'objects', organizationId, objects: chunk })
    )
  }
}

/**
 * Every stored object of the files `scope` selects, page by page. Neither organization files nor
 * chat uploads keep versions (`workspace_file_version_owner_match` admits only workspace and
 * Project files), so the file rows name every object.
 */
export async function enqueueFilePages(
  tx: DbTransaction,
  organizationId: string,
  scope: SQL | undefined
) {
  let cursor: string | undefined
  while (true) {
    const files = await tx
      .select({ id: workspaceFiles.id, key: workspaceFiles.key, context: workspaceFiles.context })
      .from(workspaceFiles)
      .where(and(scope, cursor ? gt(workspaceFiles.id, cursor) : undefined))
      .orderBy(asc(workspaceFiles.id))
      .limit(CLEANUP_BATCH_SIZE)
    if (files.length === 0) return
    await enqueueObjects(tx, organizationId, files)
    cursor = files[files.length - 1].id
    if (files.length < CLEANUP_BATCH_SIZE) return
  }
}

/**
 * Queues every stored object of the organization's Knowledge files (connector caches) and of its
 * knowledge bases' documents, in the caller's transaction and before the rows that name them are
 * deleted. The caller holds the organization row lock.
 */
export async function enqueueOrganizationStoredObjectCleanup(
  tx: DbTransaction,
  organizationId: string
): Promise<void> {
  await enqueueFilePages(
    tx,
    organizationId,
    and(eq(workspaceFiles.organizationId, organizationId), isNull(workspaceFiles.workspaceId))
  )

  let documentCursor: string | undefined
  while (true) {
    const documents = await tx
      .select({ id: document.id, key: document.storageKey })
      .from(document)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
      .where(
        and(
          eq(knowledgeBase.organizationId, organizationId),
          isNotNull(document.storageKey),
          documentCursor ? gt(document.id, documentCursor) : undefined
        )
      )
      .orderBy(asc(document.id))
      .limit(CLEANUP_BATCH_SIZE)
    if (documents.length === 0) break
    await enqueueObjects(
      tx,
      organizationId,
      documents.map(({ key }) => ({ key, context: 'knowledge-base' }))
    )
    documentCursor = documents[documents.length - 1].id
    if (documents.length < CLEANUP_BATCH_SIZE) break
  }
}
