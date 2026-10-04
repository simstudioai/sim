import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { maybeNotifyStorageLimitForBillingContext } from '@/lib/billing/storage/tracking'
import {
  type AuthorizingUseCase,
  recordProjectedUseCaseAuditEntries,
} from '@/lib/core/application/authorized-workspace-use-case'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import {
  createProjectFileAuthorizer,
  type ProjectFileAuthorizationContext,
} from '@/lib/projects/files/application/authorization'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { prepareProjectFileAccounting } from '@/lib/projects/files/application/write-effects'
import { notifyFileListChanged } from '@/lib/realtime/notify'
import {
  archiveFolderName,
  MAX_ARCHIVE_BYTES,
  prepareArchiveExtraction,
} from '@/lib/uploads/archive'
import { resolveFileFolderTarget } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { getBoundWorkspaceFileSecretProvenanceByMetadata } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { isArchiveFileName } from '@/lib/uploads/utils/file-utils'
import {
  commitFileArchiveInTx,
  discardFileArchive,
  stageFileArchive,
} from '@/lib/workspace-files/archive-extraction'
import {
  FILE_EXTRACTION_BUDGET_MS,
  requireFileExtractionLeaseInTx,
  withFileExtractionLease,
} from '@/lib/workspace-files/extraction-lease'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

interface ExtractProjectFileInput {
  projectId: string
  fileId: string
}

async function snapshotArchive(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  fileId: string
) {
  await acquireFolderMutationLock(tx, `project:${context.projectId}`, 'file')
  const [file] = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(context.owner),
        eq(workspaceFiles.id, fileId),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .for('update')
    .limit(1)
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const provenance = (await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [file])).get(
    file.id
  )
  if (!provenance) throw new Error('Archive provenance is unavailable')
  const parent = await resolveFileFolderTarget(context.owner, { folderId: file.folderId }, tx)
  const parentSegments = parent ? parseWorkspaceFileFolderDisplayPath(parent.path) : []
  return {
    file,
    provenance,
    parentSegments,
    identity: JSON.stringify({
      key: file.key,
      name: file.originalName,
      size: getWorkspaceFileSize(file),
      contentType: file.contentType,
      contentUpdatedAt: file.contentUpdatedAt,
      updatedAt: file.updatedAt,
      folderId: file.folderId,
      parentSegments,
      provenance,
    }),
  }
}

/** Stages bounded archive members, then atomically publishes their tree under fresh owner authority. */
export const extractProjectFile: AuthorizingUseCase<
  typeof projectFileOperations.extractArchive,
  ExtractProjectFileInput,
  Awaited<ReturnType<typeof commitFileArchiveInTx>>
> = {
  operation: projectFileOperations.extractArchive,
  delegationAudience: projectFileOperations.extractArchive.delegationAudience,
  async authorize(args) {
    const authorize = await createProjectFileAuthorizer(
      args.principal,
      projectFileOperations.extractArchive,
      args.input
    )
    await db.transaction(authorize)
  },
  async execute(args) {
    const input = structuredClone(args.input)
    const authorize = await createProjectFileAuthorizer(
      args.principal,
      projectFileOperations.extractArchive,
      input
    )
    // actorless-unsupported: Project file authorization requires the original human subject.
    const userId = requirePrincipalSubjectUserId(args.principal)
    const prepared = await db.transaction(async (tx) => {
      const context = await authorize(tx)
      return { context, snapshot: await snapshotArchive(tx, context, input.fileId) }
    })
    const { file } = prepared.snapshot
    if (!isArchiveFileName(file.originalName))
      throw new OrchestrationError('validation', 'Only .zip files can be unzipped')
    if (getWorkspaceFileSize(file) > MAX_ARCHIVE_BYTES)
      throw new OrchestrationError('payload_too_large', 'Archive exceeds the unzip limit')
    return withFileExtractionLease(prepared.context.owner, file.id, async (lease) => {
      const deadline = AbortSignal.timeout(FILE_EXTRACTION_BUDGET_MS)
      const signal = args.request?.signal
        ? AbortSignal.any([deadline, args.request.signal])
        : deadline
      try {
        const staged = await runWithOutboundOrganization(
          prepared.context.organizationId,
          async () => {
            const bytes = await downloadFile({
              key: file.key,
              context: 'project',
              maxBytes: MAX_ARCHIVE_BYTES,
              signal,
            })
            if (bytes.length !== getWorkspaceFileSize(file))
              throw new OrchestrationError('conflict', 'Archive bytes changed; retry')
            const plan = await prepareArchiveExtraction(bytes, {
              rootFolderSegments: [
                ...prepared.snapshot.parentSegments,
                archiveFolderName(file.originalName),
              ],
              includeRootFolder: true,
              skipNoiseEntries: true,
              signal,
            })
            if (!plan.entryCount)
              throw new OrchestrationError(
                'validation',
                'No files could be unzipped from this archive'
              )
            return stageFileArchive(plan, { owner: prepared.context.owner, userId, signal })
          }
        )
        let committed
        try {
          committed = await db.transaction(async (tx) => {
            signal.throwIfAborted()
            const context = await authorize(tx)
            await requireFileExtractionLeaseInTx(tx, lease)
            const accounting = await prepareProjectFileAccounting(tx, context)
            const current = await snapshotArchive(tx, context, file.id)
            if (current.identity !== prepared.snapshot.identity)
              throw new OrchestrationError('conflict', 'Archive or destination changed; retry')
            const result = await commitFileArchiveInTx(tx, {
              owner: context.owner,
              userId,
              rootName: archiveFolderName(current.file.originalName),
              parentId: current.file.folderId,
              parentSegments: current.parentSegments,
              staged,
              secretProvenance: current.provenance,
              signal,
            })
            const usage = await accounting.mutation.applyDelta(staged.bytes)
            signal.throwIfAborted()
            await requireFileExtractionLeaseInTx(tx, lease)
            return { context, result, billing: accounting.billing, usage }
          })
        } catch (error) {
          try {
            await discardFileArchive(staged)
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'Archive publication and cleanup failed'
            )
          }
          throw error
        }
        await notifyFileListChanged(committed.context.owner)
        recordProjectedUseCaseAuditEntries(
          projectFileOperations.extractArchive,
          null,
          args.principal,
          args.request,
          [
            {
              action: AuditAction.FILE_UPDATED,
              resourceType: AuditResourceType.FILE,
              resourceId: file.id,
              resourceName: file.originalName,
              description: `Unzipped Project file "${file.originalName}"`,
              metadata: { projectId: committed.context.projectId, ...committed.result },
            },
          ],
          committed.context.organizationId ?? undefined
        )
        await maybeNotifyStorageLimitForBillingContext(committed.billing, committed.usage)
        return committed.result
      } catch (error) {
        if (deadline.aborted && error === deadline.reason)
          throw new OrchestrationError(
            'payload_too_large',
            'Unzipping took too long and was cancelled. Try a smaller archive.'
          )
        throw error
      }
    })
  },
}
