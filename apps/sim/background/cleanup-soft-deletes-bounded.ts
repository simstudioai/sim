import { db } from '@sim/db'
import {
  copilotChats,
  document,
  folder,
  knowledgeBase,
  mcpServers,
  memory,
  userTableDefinitions,
  workflow,
  workflowMcpServer,
  workspaceFile,
  workspaceFiles,
} from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  decrementStorageUsageForBillingContextInTx,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import { type BoundedCleanup, setCleanupTimeouts } from '@/lib/cleanup/bounded'
import { boundedDelete } from '@/lib/cleanup/bounded-delete'
import type { CleanupType } from '@/lib/cleanup/bounded-types'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import {
  type CleanupOwnerScope,
  cleanupOwnerCondition,
  resolveCleanupOwnerScope,
} from '@/lib/cleanup/resource-scope'
import {
  enqueueRetentionStorageCleanup,
  processRetentionStorageCleanup,
} from '@/lib/cleanup/storage-outbox'
import { hardDeleteDocuments } from '@/lib/knowledge/documents/service'
import { cleanupKnowledgeStorageBinding } from '@/lib/knowledge/documents/storage-cleanup'
import { isUsingCloudStorage, type StorageContext } from '@/lib/uploads'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { reRootActiveFolderChildrenUnguarded } from '@/background/cleanup-soft-deletes'

/** Budgets count parent selections; required cascading effects are kept with their parent batch. */
export async function runBoundedSoftDeleteScope(
  payload: CleanupJobPayload,
  control: BoundedCleanup
) {
  const cutoff = new Date(Date.now() - payload.retentionHours * 3600_000)
  const owner = resolveCleanupOwnerScope(payload)
  for (const ids of chunkArray(owner.ids, 50)) {
    const scope = { ...owner, ids }
    let chatCleanup: Awaited<ReturnType<typeof prepareChatCleanup>> | undefined
    if (scope.kind === 'workspace') {
      await boundedDelete(
        control,
        'workflows',
        workflow,
        workflow.id,
        and(
          inArray(workflow.workspaceId, ids),
          isNotNull(workflow.archivedAt),
          lt(workflow.archivedAt, cutoff)
        ),
        {
          before: async (workflowIds) => {
            // Collect every child chat; a parent limit cannot silently truncate its required cleanup.
            const chatIds: string[] = []
            let after: string | undefined
            while (true) {
              control.assertTimeRemaining()
              const rows = await control.query(async (tx) =>
                tx
                  .select({ id: copilotChats.id })
                  .from(copilotChats)
                  .where(
                    and(
                      inArray(copilotChats.workflowId, workflowIds),
                      after ? gt(copilotChats.id, after) : undefined
                    )
                  )
                  .orderBy(asc(copilotChats.id))
                  .limit(control.options.batchSize)
              )
              if (rows.length === 0) break
              chatIds.push(...rows.map((row) => row.id))
              after = rows[rows.length - 1].id
            }
            chatCleanup = await prepareChatCleanup(chatIds, payload.label, {
              control,
              type: 'workflows',
            })
          },
          after: async () => {
            await chatCleanup?.execute()
          },
        }
      )
    }
    await boundedDelete(
      control,
      'chats',
      copilotChats,
      copilotChats.id,
      and(
        cleanupOwnerCondition(copilotChats, scope),
        isNotNull(copilotChats.deletedAt),
        lt(copilotChats.deletedAt, cutoff)
      ),
      {
        before: async (chatIds) => {
          chatCleanup = await prepareChatCleanup(chatIds, payload.label, { control, type: 'chats' })
        },
        after: async () => {
          await chatCleanup?.execute()
        },
      }
    )
    await cleanupFiles(control, scope, cutoff)
    await boundedDelete(
      control,
      'knowledgeBases',
      knowledgeBase,
      knowledgeBase.id,
      and(
        cleanupOwnerCondition(knowledgeBase, scope),
        isNotNull(knowledgeBase.deletedAt),
        lt(knowledgeBase.deletedAt, cutoff)
      ),
      {
        beforeDelete: async (kbIds, tx) => {
          // Existing ledger/outbox implementation owns document and embedding deletion.
          while (true) {
            control.assertTimeRemaining()
            const rows = await tx
              .select({ id: document.id })
              .from(document)
              .where(inArray(document.knowledgeBaseId, kbIds))
              .orderBy(asc(document.id))
              .limit(control.options.batchSize)
            if (rows.length === 0) break
            const deleted = await hardDeleteDocuments(
              rows.map((row) => row.id),
              payload.label,
              undefined,
              undefined,
              undefined,
              undefined,
              async (query) => query(tx)
            )
            if (deleted !== rows.length)
              throw new Error('Knowledge-base document cleanup did not delete its selected batch')
          }
        },
      }
    )
    if (scope.kind === 'workspace') {
      const targets = [
        {
          type: 'folders',
          table: folder,
          date: folder.deletedAt,
          extra: inArray(folder.resourceType, ['workflow', 'file', 'knowledge_base', 'table']),
        },
        { type: 'userTables', table: userTableDefinitions, date: userTableDefinitions.archivedAt },
        { type: 'memories', table: memory, date: memory.deletedAt },
        { type: 'mcpServers', table: mcpServers, date: mcpServers.deletedAt },
        { type: 'workflowMcpServers', table: workflowMcpServer, date: workflowMcpServer.deletedAt },
      ] as const
      for (const target of targets) {
        await boundedDelete(
          control,
          target.type,
          target.table,
          target.table.id,
          and(
            inArray(target.table.workspaceId, ids),
            isNotNull(target.date),
            lt(target.date, cutoff),
            'extra' in target ? target.extra : undefined
          ),
          target.type === 'folders'
            ? {
                beforeDelete: (folderIds, tx) =>
                  reRootActiveFolderChildrenUnguarded(folderIds, cutoff, payload.label, tx, true),
              }
            : {}
        )
      }
    }
    await cleanupOrphanBindings(control, scope)
    if (control.stopped()) return
  }
}

async function cleanupFiles(control: BoundedCleanup, scope: CleanupOwnerScope, cutoff: Date) {
  if (scope.kind === 'workspace') {
    const eligible = and(
      inArray(workspaceFile.workspaceId, scope.ids),
      isNotNull(workspaceFile.deletedAt),
      lt(workspaceFile.deletedAt, cutoff)
    )
    await control.batches(
      'legacyFiles',
      (limit, seen) =>
        control.query(async (tx) =>
          tx
            .select({ id: workspaceFile.id, key: workspaceFile.key })
            .from(workspaceFile)
            .where(and(eligible, seen.length ? notInArray(workspaceFile.id, seen) : undefined))
            .orderBy(asc(workspaceFile.id))
            .limit(limit)
        ),
      (row) => row.id,
      async (rows) => {
        const { deleted, events } = await control.query(async (tx) => {
          const deleted = await tx
            .delete(workspaceFile)
            .where(
              and(
                eligible,
                inArray(
                  workspaceFile.id,
                  rows.map((row) => row.id)
                )
              )
            )
            .returning({ id: workspaceFile.id, key: workspaceFile.key })
          const events = isUsingCloudStorage()
            ? await enqueueRetentionStorageCleanup(
                tx,
                deleted.map((row) => row.key),
                'workspace',
                control.options.batchSize
              )
            : []
          return { deleted, events }
        })
        await control.deleted('legacyFiles', deleted.length)
        await processRetentionStorageCleanup(control, 'legacyFiles', events)
      }
    )
  }
  const eligible = and(
    cleanupOwnerCondition(workspaceFiles, scope),
    isNotNull(workspaceFiles.deletedAt),
    lt(workspaceFiles.deletedAt, cutoff),
    scope.kind === 'organization' ? eq(workspaceFiles.context, 'knowledge-base') : undefined
  )
  await control.batches(
    'files',
    (limit, seen) =>
      control.query(async (tx) =>
        tx
          .select({
            id: workspaceFiles.id,
            key: workspaceFiles.key,
            context: workspaceFiles.context,
            workspaceId: workspaceFiles.workspaceId,
            sizeBytes: workspaceFiles.sizeBytes,
          })
          .from(workspaceFiles)
          .where(and(eligible, seen.length ? notInArray(workspaceFiles.id, seen) : undefined))
          .orderBy(asc(workspaceFiles.id))
          .limit(limit)
      ),
    (row) => row.id,
    async (rows) => {
      for (const row of rows) getWorkspaceFileSize(row)
      // Delete exact selected versions and couple billable deletions with their ledger decrement.
      // One row at a time keeps different payer/context transactions independent and observable.
      for (const row of rows) {
        const billing =
          row.context === 'workspace'
            ? await control.query((executor) => {
                if (!row.workspaceId) throw new Error(`Billable file ${row.id} has no workspace`)
                return resolveStorageBillingContext(row.workspaceId, { executor })
              })
            : undefined
        const remove = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
          const deleted = await tx
            .delete(workspaceFiles)
            .where(
              and(
                eligible,
                eq(workspaceFiles.id, row.id),
                eq(workspaceFiles.context, row.context),
                billing ? eq(workspaceFiles.workspaceId, billing.workspaceId) : undefined
              )
            )
            .returning({
              id: workspaceFiles.id,
              key: workspaceFiles.key,
              sizeBytes: workspaceFiles.sizeBytes,
            })
          if (billing)
            await decrementStorageUsageForBillingContextInTx(
              tx,
              billing,
              deleted.reduce((sum, file) => sum + getWorkspaceFileSize(file), 0)
            )
          const events = isUsingCloudStorage()
            ? await enqueueRetentionStorageCleanup(
                tx,
                deleted.map((file) => file.key),
                row.context as StorageContext,
                control.options.batchSize
              )
            : []
          return { deleted, events }
        }
        const { deleted, events } = billing
          ? await db.transaction(async (tx) => {
              await setCleanupTimeouts(tx)
              return remove(tx)
            })
          : await control.query(remove)
        await control.deleted('files', deleted.length)
        await processRetentionStorageCleanup(control, 'files', events)
      }
    }
  )
}

async function cleanupOrphanBindings(control: BoundedCleanup, scope: CleanupOwnerScope) {
  const type: CleanupType = 'orphanKnowledgeBaseBindings'
  const eligible = and(
    cleanupOwnerCondition(workspaceFiles, scope),
    eq(workspaceFiles.context, 'knowledge-base'),
    isNull(workspaceFiles.deletedAt),
    lt(workspaceFiles.uploadedAt, new Date(Date.now() - 7 * 86400_000)),
    sql`NOT EXISTS (SELECT 1 FROM ${document} doc WHERE doc.storage_key = ${workspaceFiles.key})`
  )
  await control.batches(
    type,
    (limit, seen) =>
      control.query(async (tx) =>
        tx
          .select({
            id: workspaceFiles.id,
            key: workspaceFiles.key,
            contentUpdatedAt: workspaceFiles.contentUpdatedAt,
            workspaceId: workspaceFiles.workspaceId,
            organizationId: workspaceFiles.organizationId,
            userId: workspaceFiles.userId,
          })
          .from(workspaceFiles)
          .where(and(eligible, seen.length ? notInArray(workspaceFiles.id, seen) : undefined))
          .orderBy(asc(workspaceFiles.id))
          .limit(limit)
      ),
    (row) => row.id,
    async (rows) => {
      for (const row of rows) {
        control.assertTimeRemaining()
        const deleted = await cleanupKnowledgeStorageBinding(
          {
            version: 1,
            documentId: `orphan:${row.id}`,
            fileId: row.id,
            key: row.key,
            contentUpdatedAt: row.contentUpdatedAt.toISOString(),
            workspaceId: row.workspaceId,
            organizationId: row.organizationId,
            userId: row.userId,
          },
          AbortSignal.timeout(15_000),
          control.query
        )
        if (deleted) {
          await control.deleted(type, 1)
          await control.files(type, 1, 0)
        }
      }
    }
  )
}
