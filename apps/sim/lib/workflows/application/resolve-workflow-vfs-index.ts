import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { listActiveFolderRows, loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workflows/application/context'
import { type WorkflowOperation, workflowOperations } from '@/lib/workflows/application/operations'

export interface ResolveWorkflowVfsIndexInput {
  workspaceId: string
}

function defineWorkflowVfsIndexUseCase<const O extends WorkflowOperation>(operation: O) {
  return defineAuthorizedWorkflowUseCase({
    operation,
    resolveContext: ({ input }: { input: ResolveWorkflowVfsIndexInput }) =>
      resolveActiveWorkspaceApplicationContext(input.workspaceId),
    async execute({ context }) {
      const [folders, folderIndex, workflows] = await Promise.all([
        listActiveFolderRows(context.workspaceId, 'workflow', {
          sortBy: 'name',
          sortOrder: 'asc',
        }),
        loadActiveFolderPathIndex(context.workspaceId, 'workflow'),
        db
          .select({ id: workflow.id, name: workflow.name, folderId: workflow.folderId })
          .from(workflow)
          .where(and(eq(workflow.workspaceId, context.workspaceId), isNull(workflow.archivedAt))),
      ])
      return { folders, folderIndex, workflows }
    },
  })
}

export const resolveWorkflowVfsUpdateIndex = defineWorkflowVfsIndexUseCase(
  workflowOperations.update
)
export const resolveWorkflowVfsCreateFolderIndex = defineWorkflowVfsIndexUseCase(
  workflowOperations.createFolder
)
export const resolveWorkflowVfsDuplicateIndex = defineWorkflowVfsIndexUseCase(
  workflowOperations.duplicate
)
export const resolveWorkflowVfsDeleteIndex = defineWorkflowVfsIndexUseCase(
  workflowOperations.delete
)
