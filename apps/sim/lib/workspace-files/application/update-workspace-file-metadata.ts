import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import {
  authorizeFileWorkflowConfiguration,
  hasActiveFileShare,
  lockWorkflowFile,
} from '@/lib/workspace-files/application/file-workflow-policy'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface UpdateWorkspaceFileMetadataInput {
  fileId: string
  assertedWorkspaceId?: string
  workflowIds: string[]
}

export const updateWorkspaceFileMetadata = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateMetadata,
  resolveContext: ({ input }: { input: UpdateWorkspaceFileMetadataInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ principal, input, context }) {
    return db.transaction(async (tx) => {
      const file = await lockWorkflowFile(tx, context.fileId, context.workspaceId)
      await authorizeFileWorkflowConfiguration({
        principal,
        workspaceId: context.workspaceId,
        fileId: context.fileId,
        contentType: file.contentType,
        workflowIds: input.workflowIds,
        publishing: await hasActiveFileShare(context.fileId, tx),
        executor: tx,
      })
      await tx
        .update(workspaceFiles)
        .set({
          workflowIds: input.workflowIds,
          workflowConfigVersion: sql`${workspaceFiles.workflowConfigVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaceFiles.id, context.fileId),
            eq(workspaceFiles.workspaceId, context.workspaceId)
          )
        )
      return { workflowIds: input.workflowIds }
    })
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: context.fileId,
    description: 'Updated HTML workflow dependencies',
    metadata: { workflowIds: result.workflowIds },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
