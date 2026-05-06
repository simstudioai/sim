import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { restoreKnowledgeBase } from '@/lib/knowledge/service'
import { getTableById, restoreTable } from '@/lib/table/service'
import {
  getWorkspaceFile,
  restoreWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { restoreWorkflow } from '@/lib/workflows/lifecycle'
import { performRestoreFolder } from '@/lib/workflows/orchestration/folder-lifecycle'
import { getWorkflowById } from '@/lib/workflows/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreResource')

const VALID_TYPES = new Set(['workflow', 'table', 'file', 'knowledgebase', 'folder'])

export async function executeRestoreResource(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const type = rawParams.type as string | undefined
  const id = rawParams.id as string | undefined

  if (!type || !VALID_TYPES.has(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}` }
  }
  if (!id) {
    return { success: false, error: 'id is required' }
  }
  if (!context.workspaceId) {
    return { success: false, error: 'Workspace context required' }
  }

  const requestId = generateId().slice(0, 8)
  const callerWorkspaceId = context.workspaceId

  const hasWriteAccess = async (resourceWorkspaceId: string | null | undefined) => {
    if (!resourceWorkspaceId || resourceWorkspaceId !== callerWorkspaceId) return false
    const permission = await getUserEntityPermissions(
      context.userId,
      'workspace',
      resourceWorkspaceId
    )
    return permission === 'write' || permission === 'admin'
  }

  try {
    switch (type) {
      case 'workflow': {
        const existing = await getWorkflowById(id, { includeArchived: true })
        if (!existing || !(await hasWriteAccess(existing.workspaceId))) {
          return { success: false, error: 'Workflow not found' }
        }
        const result = await restoreWorkflow(id, { requestId })
        if (!result.restored) {
          return { success: false, error: 'Workflow not found or not archived' }
        }
        logger.info('Workflow restored via copilot', { workflowId: id })
        return {
          success: true,
          output: { type, id, name: result.workflow?.name },
          resources: [{ type: 'workflow', id, title: result.workflow?.name || id }],
        }
      }

      case 'table': {
        const existing = await getTableById(id, { includeArchived: true })
        if (!existing || !(await hasWriteAccess(existing.workspaceId))) {
          return { success: false, error: 'Table not found' }
        }
        await restoreTable(id, requestId)
        const table = await getTableById(id)
        const tableName = table?.name || existing.name
        logger.info('Table restored via copilot', { tableId: id, name: tableName })
        return {
          success: true,
          output: { type, id, name: tableName },
          resources: [{ type: 'table', id, title: tableName }],
        }
      }

      case 'file': {
        if (!(await hasWriteAccess(context.workspaceId))) {
          return { success: false, error: 'File not found' }
        }
        await restoreWorkspaceFile(context.workspaceId, id)
        const fileRecord = await getWorkspaceFile(context.workspaceId, id)
        const fileName = fileRecord?.name || id
        logger.info('File restored via copilot', { fileId: id, name: fileName })
        return {
          success: true,
          output: { type, id, name: fileName },
          resources: [{ type: 'file', id, title: fileName }],
        }
      }

      case 'knowledgebase': {
        const [existing] = await db
          .select({ workspaceId: knowledgeBase.workspaceId })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, id))
          .limit(1)
        if (!existing || !(await hasWriteAccess(existing.workspaceId))) {
          return { success: false, error: 'Knowledge base not found' }
        }
        await restoreKnowledgeBase(id, requestId)
        logger.info('Knowledge base restored via copilot', { knowledgeBaseId: id })
        return {
          success: true,
          output: { type, id },
        }
      }

      case 'folder': {
        if (!(await hasWriteAccess(context.workspaceId))) {
          return { success: false, error: 'Folder not found' }
        }
        const result = await performRestoreFolder({
          folderId: id,
          workspaceId: context.workspaceId,
          userId: context.userId,
        })
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to restore folder' }
        }
        logger.info('Folder restored via copilot', { folderId: id })
        return {
          success: true,
          output: { type, id, restoredItems: result.restoredItems },
        }
      }

      default:
        return { success: false, error: `Unsupported type: ${type}` }
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}
