import { db } from '@sim/db'
import { workspaceOperationReceipt } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  continueOutboxHandler,
  enqueueOutboxEvent,
  type OutboxHandlerRegistry,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import {
  type ForkContentCopyPayload,
  runForkContentCopy,
} from '@/ee/workspace-forking/lib/copy/content-copy-runner'
import {
  ForkCopyCheckpointError,
  ForkCopyContinuation,
} from '@/ee/workspace-forking/lib/copy/progress'

const id = z.string().min(1).max(4096)
const identityMap = z.record(id, id)
const pair = z.object({ sourceId: id, childId: id }).strict()
const contentPayloadSchema = z
  .object({
    operationId: id,
    workspaceId: id,
    copyFinished: z.boolean().optional(),
    progress: z
      .object({
        completed: z.array(id).max(20000),
        tables: z.record(
          id,
          z
            .object({
              afterId: id,
              copied: z.number().int().min(0),
              lastOrderKey: z.string().max(256).nullable(),
            })
            .strict()
        ),
        embeddings: z.record(
          id,
          z
            .object({
              afterId: id.nullable(),
              sourceRevision: z.string().length(64),
              knowledgeBaseId: id,
            })
            .strict()
        ),
      })
      .strict()
      .optional(),
    copy: z
      .object({
        contentPlan: z
          .object({
            sourceWorkspaceId: id,
            childWorkspaceId: id,
            userId: id,
            tables: z.array(pair).max(2000),
            knowledgeBases: z.array(pair.extend({ documentIdMap: identityMap })).max(2000),
            skills: z.array(z.object({ childId: id }).strict()).max(2000),
            documents: z
              .array(
                z
                  .object({
                    sourceDocId: id,
                    childDocId: id,
                    childKnowledgeBaseId: id,
                    storageKey: id.nullable(),
                    fileUrl: z.string().max(16384),
                    fileSize: z.number().min(0),
                    filename: z.string().max(4096),
                    mimeType: z.string().max(1024),
                  })
                  .strict()
              )
              .max(10000),
            documentMappingContext: z
              .object({ edgeChildWorkspaceId: id, sourceIsParent: z.boolean() })
              .strict()
              .optional(),
          })
          .strict(),
        blobTasks: z
          .array(
            z
              .object({
                sourceFileId: id.optional(),
                sourceContentUpdatedAtMs: z.number().optional(),
                sourceKey: id,
                targetKey: id,
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
                ]),
                fileName: z.string().max(4096),
                contentType: z.string().max(1024),
                size: z.number().min(0),
                targetFileId: id,
                displayName: z.string().max(4096).nullable(),
                userId: id,
                workspaceId: id,
                targetFolderId: id.nullable().optional(),
              })
              .strict()
          )
          .max(2000),
        contentRefMaps: z
          .object({
            workspaceId: z.object({ from: id, to: id }).strict().optional(),
            fileKeys: identityMap.optional(),
            fileIds: identityMap.optional(),
            workflows: identityMap.optional(),
            knowledgeBases: identityMap.optional(),
            tables: identityMap.optional(),
            skills: identityMap.optional(),
            folders: identityMap.optional(),
          })
          .strict()
          .optional(),
        statusId: id.optional(),
        completionStatus: z.enum(['completed', 'completed_with_warnings']).optional(),
        deployedTargetWorkflowIds: z.array(id).max(1000).optional(),
        requestId: id.optional(),
      })
      .strict(),
  })
  .strict()

export async function enqueueDurableForkContent(
  tx: DbOrTx,
  report: WorkspaceOperationReport,
  copy: ForkContentCopyPayload
): Promise<string> {
  const payload = contentPayloadSchema.parse({
    operationId: report.operationId,
    workspaceId: report.workspaceId,
    copy,
  })
  if (Buffer.byteLength(JSON.stringify(payload)) > 8 * 1024 * 1024)
    throw new OrchestrationError('payload_too_large', 'Fork background work exceeds 8 MiB')
  return enqueueOutboxEvent(tx, 'workspace.fork.content.copy', payload)
}

export const forkContentOutboxHandlers = {
  'workspace.fork.content.copy': withOutboxHandlerTimeout(async (raw, context) => {
    const payload = contentPayloadSchema.parse(raw)
    const [receipt] = await db
      .select({ report: workspaceOperationReceipt.report })
      .from(workspaceOperationReceipt)
      .where(
        and(
          eq(workspaceOperationReceipt.id, payload.operationId),
          eq(workspaceOperationReceipt.workspaceId, payload.workspaceId)
        )
      )
      .limit(1)
    if (!receipt) return
    const report = receipt.report as WorkspaceOperationReport
    if (report.copyProgress?.status !== 'pending') return
    let checkpointTail = Promise.resolve()
    try {
      await runForkContentCopy(payload.copy, {
        preserveSnapshots: true,
        signal: context.signal,
        control: {
          signal: context.signal,
          deadlineAt: context.deadlineAt,
          progress: payload.progress ?? { completed: [], tables: {}, embeddings: {} },
          checkpoint: async (progress) => {
            context.signal.throwIfAborted()
            if (Buffer.byteLength(JSON.stringify(progress)) > 2 * 1024 * 1024)
              throw new ForkCopyCheckpointError('Copy checkpoint exceeds 2 MiB')
            const snapshot = structuredClone(progress)
            checkpointTail = checkpointTail.then(async () => {
              context.signal.throwIfAborted()
              try {
                await context.checkpointPayload({ progress: snapshot })
              } catch (error) {
                throw new ForkCopyCheckpointError('Could not retain the copy checkpoint', {
                  cause: error,
                })
              }
            })
            await checkpointTail
          },
        },
        onComplete: async ({ copied, failed }) => {
          context.signal.throwIfAborted()
          await context.checkpointPayload({ copyFinished: true })
          await db.transaction(async (tx) => {
            const [current] = await tx
              .select({ report: workspaceOperationReceipt.report })
              .from(workspaceOperationReceipt)
              .where(eq(workspaceOperationReceipt.id, payload.operationId))
              .for('update')
              .limit(1)
            context.signal.throwIfAborted()
            if (!current) return
            const report = current.report as WorkspaceOperationReport
            if (report.copyProgress?.status !== 'pending') return
            const updated: WorkspaceOperationReport = {
              ...report,
              copyProgress: { status: failed ? 'failed' : 'completed', copied, failed },
              status:
                report.deploymentOperationIds?.length || report.effectEventIds?.length
                  ? 'processing'
                  : failed
                    ? 'failed'
                    : report.issues.some((issue) => issue.code === 'required_configuration')
                      ? 'requires_configuration'
                      : report.issues.length
                        ? 'completed_with_warnings'
                        : 'completed',
              issues: failed
                ? [
                    ...report.issues,
                    {
                      code: 'resource_copy_failed',
                      message: `${failed} selected resources could not be copied; the workspace changes remain committed`,
                    },
                  ]
                : report.issues,
            }
            await tx
              .update(workspaceOperationReceipt)
              .set({ report: updated, updatedAt: new Date() })
              .where(eq(workspaceOperationReceipt.id, payload.operationId))
          })
        },
      })
    } catch (error) {
      if (error instanceof ForkCopyContinuation) return continueOutboxHandler(error.message, 1000)
      throw error
    }
  }, 550000),
} satisfies OutboxHandlerRegistry
