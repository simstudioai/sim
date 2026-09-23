import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { publicShare, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { fileWorkflowIdsSchema, isWorkflowHtml } from '@/lib/workspace-files/workflows/types'

/** The file lock serializes dependency changes with publication and content writes. */
export async function lockWorkflowFile(executor: DbOrTx, fileId: string, workspaceId: string) {
  const [file] = await executor
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .for('update')
    .limit(1)
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return file
}

export async function hasActiveFileShare(fileId: string, executor: DbOrTx = db) {
  const [share] = await executor
    .select({ id: publicShare.id })
    .from(publicShare)
    .where(
      and(
        eq(publicShare.resourceType, 'file'),
        eq(publicShare.resourceId, fileId),
        eq(publicShare.isActive, true)
      )
    )
    .limit(1)
  return Boolean(share)
}

/** Validates dependencies under the file operation's existing delegation, without changing identity. */
export async function authorizeFileWorkflowConfiguration(args: {
  principal: Principal
  workspaceId: string
  fileId?: string
  contentType: string
  workflowIds: string[]
  publishing: boolean
  executor?: DbOrTx
}) {
  const parsed = fileWorkflowIdsSchema.safeParse(args.workflowIds)
  if (!parsed.success)
    throw new OrchestrationError(
      'validation',
      'workflowIds must contain at most 10 unique workflow IDs'
    )
  if (args.workflowIds.length && !isWorkflowHtml(args.contentType))
    throw new OrchestrationError('validation', 'Only HTML documents can call workflows')
  for (const workflowId of args.workflowIds) {
    const context = await resolveActiveWorkflowApplicationContext(
      {
        workflowId,
        assertedWorkspaceId: args.workspaceId,
      },
      args.executor
    )
    await authorizeWorkspaceOperation(
      args.principal,
      args.publishing ? fileOperations.publishWorkflows : workflowOperations.execute,
      { ...context, fileId: args.fileId },
      { delegation: workspaceFileDelegationPolicy, executor: args.executor }
    )
    if (!context.workflow.isDeployed)
      throw new OrchestrationError('validation', 'File workflows must be deployed')
  }
}
