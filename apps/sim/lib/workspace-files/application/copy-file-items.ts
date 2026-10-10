import { isUtf8 } from 'node:buffer'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { prepareFileAccountingInTx } from '@/lib/billing/storage/accounting'
import { maybeNotifyStorageLimitForBillingContext } from '@/lib/billing/storage/tracking'
import {
  type AuthorizingUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyFileListChanged } from '@/lib/realtime/notify'
import { assertFileFolderTarget } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  discardStagedFileContent,
  planFileIdentity,
  type StagedFileContent,
  stageFileContent,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  getDocumentSourceLanguage,
  getE2BDocFormat,
  isCompiledDocumentBuffer,
} from '@/lib/uploads/documents'
import { getWorkspaceFileSize, MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { isMarkdownFile, isRenderableDocumentName } from '@/lib/uploads/utils/file-utils'
import {
  type CopyFileItemsInput,
  createFileCopyAuthorizer,
} from '@/lib/workspace-files/application/copy-authorization'
import { fileCopyOperation } from '@/lib/workspace-files/application/copy-operation'
import {
  type CopiedFileItems,
  commitFileCopyInTx,
  requireUnchangedFileCopy,
  snapshotFileCopyInTx,
} from '@/lib/workspace-files/copy'
import { rewriteCopiedFileReferences } from '@/lib/workspace-files/copy-references'
import { lockFileDirectories } from '@/lib/workspace-files/locks'

/** Atomic source-read/destination-write copy; staging never holds authorization or accounting locks. */
export const copyFileItems: AuthorizingUseCase<
  typeof fileCopyOperation,
  CopyFileItemsInput,
  CopiedFileItems
> = {
  operation: fileCopyOperation,
  delegationAudience: fileCopyOperation.delegationAudience,
  async authorize(args) {
    const input = structuredClone(args.input)
    const authorize = await createFileCopyAuthorizer(args.principal, input)
    await db.transaction(async (tx) => {
      const context = await authorize(tx)
      await lockFileDirectories(tx, [context.source.owner, context.destination.owner])
      await assertFileFolderTarget(context.destination.owner, input.destination.folderId, tx)
      await snapshotFileCopyInTx(tx, { ...input.source, owner: context.source.owner })
    })
  },
  async execute(args) {
    const input = structuredClone(args.input)
    const authorize = await createFileCopyAuthorizer(args.principal, input)
    // actorless-unsupported: the copy authorizer has rejected actorless principals; creator attribution retains its human subject.
    const userId = requirePrincipalSubjectUserId(args.principal)
    const prepared = await db.transaction(async (tx) => {
      const context = await authorize(tx)
      await lockFileDirectories(tx, [context.source.owner, context.destination.owner])
      await assertFileFolderTarget(context.destination.owner, input.destination.folderId, tx)
      return {
        context,
        snapshot: await snapshotFileCopyInTx(tx, { ...input.source, owner: context.source.owner }),
      }
    })
    const staged = new Map<string, StagedFileContent>()
    const identities = new Map(
      prepared.snapshot.files.map((file) => [
        file.id,
        planFileIdentity(prepared.context.destination.owner),
      ])
    )
    const fileIds = new Map([...identities].map(([sourceId, identity]) => [sourceId, identity.id]))
    const fileKeys = new Map(
      prepared.snapshot.files.map((file) => {
        const id = fileIds.get(file.id)
        if (!id) throw new Error('Copied file identity plan is incomplete')
        return [file.key, id]
      })
    )
    let stagedBytes = 0
    const committed = await (async () => {
      try {
        for (const source of prepared.snapshot.files) {
          const content = await runWithOutboundOrganization(
            prepared.context.source.organizationId,
            () =>
              downloadFile({
                key: source.key,
                context: prepared.context.source.owner.entityType,
                maxBytes: getWorkspaceFileSize(source),
              })
          )
          if (content.length !== getWorkspaceFileSize(source)) {
            throw new OrchestrationError('conflict', 'Source file size changed during copy')
          }
          const textual =
            source.contentType.startsWith('text/') ||
            ['application/json', 'application/xml', 'application/javascript'].includes(
              source.contentType
            ) ||
            isMarkdownFile({ name: source.originalName, type: source.contentType }) ||
            isRenderableDocumentName(source.originalName)
          let copiedContent = content
          if (
            textual &&
            isUtf8(content) &&
            !isCompiledDocumentBuffer(source.originalName, content)
          ) {
            const text = content.toString('utf8')
            const format = await getE2BDocFormat(source.originalName)
            copiedContent = Buffer.from(
              rewriteCopiedFileReferences(
                text,
                {
                  sourceOwner: prepared.context.source.owner,
                  destinationOwner: prepared.context.destination.owner,
                  fileIds,
                  fileKeys,
                },
                format ? getDocumentSourceLanguage(text, format, source.contentType) : null
              )
            )
          }
          stagedBytes += copiedContent.length
          if (stagedBytes > MAX_BUFFERED_TRANSFER_BYTES)
            throw new OrchestrationError(
              'payload_too_large',
              'Copied content exceeds the buffered transfer limit'
            )
          staged.set(
            source.id,
            await runWithOutboundOrganization(prepared.context.destination.organizationId, () =>
              stageFileContent({
                owner: prepared.context.destination.owner,
                userId,
                name: source.originalName,
                contentType: source.contentType,
                content: copiedContent,
              })
            )
          )
        }
        return await db.transaction(async (tx) => {
          const context = await authorize(tx)
          const accounting = await prepareFileAccountingInTx(tx, context.destination.owner)
          await lockFileDirectories(tx, [context.source.owner, context.destination.owner])
          const current = await snapshotFileCopyInTx(tx, {
            ...input.source,
            owner: context.source.owner,
          })
          requireUnchangedFileCopy(prepared.snapshot, current)
          const result = await commitFileCopyInTx(tx, {
            snapshot: current,
            destination: { owner: context.destination.owner, folderId: input.destination.folderId },
            userId,
            staged,
            identities,
          })
          return {
            context,
            result,
            billing: accounting.billing,
            usage: await accounting.mutation.applyDelta(stagedBytes),
          }
        })
      } catch (error) {
        const cleanups = await Promise.allSettled(
          [...staged.values()].map(discardStagedFileContent)
        )
        const failed = cleanups.find((cleanup) => cleanup.status === 'rejected')
        if (failed?.status === 'rejected') {
          throw new AggregateError(
            [error, failed.reason],
            'Copy failed and durable cleanup could not be recorded'
          )
        }
        throw error
      }
    })()
    const owner = committed.context.destination.owner
    const workspaceId = owner.entityType === 'workspace' ? owner.entityId : null
    const metadata = { source: input.source, destination: input.destination }
    const entries: WorkspaceUseCaseAuditEntry[] = [
      ...committed.result.files.map((file) => ({
        action: AuditAction.FILE_UPLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: file.id,
        resourceName: file.name,
        metadata,
      })),
      ...committed.result.folders.map((folder) => ({
        action: AuditAction.FOLDER_CREATED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folder.id,
        resourceName: folder.name,
        metadata,
      })),
    ]
    if (committed.result.files.length || committed.result.folders.length) {
      await notifyFileListChanged(committed.context.destination.owner)
    }
    recordProjectedUseCaseAuditEntries(
      fileCopyOperation,
      workspaceId,
      args.principal,
      args.request,
      entries,
      committed.context.destination.organizationId ?? undefined
    )
    if (committed.usage !== undefined) {
      await maybeNotifyStorageLimitForBillingContext(committed.billing, committed.usage)
    }
    return committed.result
  },
}
