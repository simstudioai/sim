import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  buildWorkflowAliasWorkflowEntries,
  isPlanAliasPath,
  resolveWorkflowAliasPath,
  resolveWorkspacePlanAliasPath,
  type WorkflowAliasTarget,
} from '@/lib/copilot/vfs/workflow-aliases'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { canonicalizeVfsPath } from './path-utils'

export async function resolveWorkflowAliasForWorkspace(args: {
  workspaceId: string
  path: string
}): Promise<WorkflowAliasTarget | null> {
  if (!(await isFeatureEnabled('mothership-beta'))) return null
  if (!isPlanAliasPath(args.path)) return null

  let canonicalPath: string
  try {
    canonicalPath = canonicalizeVfsPath(args.path)
  } catch {
    canonicalPath = args.path.trim().replace(/^\/+|\/+$/g, '')
  }

  const workspacePlanAlias = resolveWorkspacePlanAliasPath(canonicalPath)
  if (workspacePlanAlias) return workspacePlanAlias

  const [workflowRows, folderRows] = await Promise.all([
    db
      .select({
        id: workflow.id,
        name: workflow.name,
        folderId: workflow.folderId,
      })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, args.workspaceId), isNull(workflow.archivedAt)))
      .orderBy(asc(workflow.sortOrder), asc(workflow.createdAt)),
    db
      .select({
        folderId: workflowFolder.id,
        folderName: workflowFolder.name,
        parentId: workflowFolder.parentId,
      })
      .from(workflowFolder)
      .where(
        and(eq(workflowFolder.workspaceId, args.workspaceId), isNull(workflowFolder.archivedAt))
      )
      .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt)),
  ])
  return resolveWorkflowAliasPath(
    canonicalPath,
    buildWorkflowAliasWorkflowEntries(workflowRows, folderRows)
  )
}
