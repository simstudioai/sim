import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import {
  getRestorableKnowledgeBase,
  performRestoreKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import { performRestoreTable } from '@/lib/table/orchestration'
import { getTableById } from '@/lib/table/service'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { performRestoreFolder, performRestoreWorkflow } from '@/lib/workflows/orchestration'
import { getWorkflowById } from '@/lib/workflows/utils'
import {
  performRestoreWorkspaceFile,
  performRestoreWorkspaceFileFolder,
} from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreResourceOrchestration')

export type RestorableResourceType =
  | 'workflow'
  | 'table'
  | 'file'
  | 'knowledgebase'
  | 'folder'
  | 'file_folder'
  | 'knowledge_folder'
  | 'table_folder'

/**
 * Folder trees the generic engine restores, keyed by the restorable type that names them.
 * `'folder'` stays the workflow tree so the existing tool contract does not shift meaning;
 * the other trees get their own names, mirroring how `file_folder` already sits beside it.
 *
 * `knowledge_folder` and `table_folder` are accepted here and by the tool handler, but the
 * model cannot emit them yet: the `restore_resource` parameter enum lives in the copilot
 * service's `contracts/tool-catalog-v1.json`, which is a different repository and is mirrored
 * into `lib/copilot/generated/**` by `scripts/sync-tool-catalog.ts`. Widening it there makes
 * these reachable with no further change on this side.
 */
const FOLDER_RESOURCE_TYPE_BY_RESTORABLE: Partial<
  Record<RestorableResourceType, FolderResourceType>
> = {
  folder: 'workflow',
  knowledge_folder: 'knowledge_base',
  table_folder: 'table',
}

export interface PerformRestoreResourceParams {
  type: RestorableResourceType
  id: string
  userId: string
  workspaceId: string
  requestId?: string
}

async function hasWriteAccess(
  userId: string,
  callerWorkspaceId: string,
  resourceWorkspaceId: string | null | undefined
): Promise<boolean> {
  if (!resourceWorkspaceId || resourceWorkspaceId !== callerWorkspaceId) return false
  const permission = await getUserEntityPermissions(userId, 'workspace', resourceWorkspaceId)
  return permission === 'write' || permission === 'admin'
}

function success(
  output: Record<string, unknown>,
  resources?: MothershipResource[]
): ToolExecutionResult {
  return { success: true, output, resources }
}

export async function performRestoreResource(
  params: PerformRestoreResourceParams
): Promise<ToolExecutionResult> {
  const { type, id, userId, workspaceId } = params
  const requestId = params.requestId ?? generateId().slice(0, 8)

  try {
    switch (type) {
      case 'workflow': {
        const existing = await getWorkflowById(id, { includeArchived: true })
        if (!existing || !(await hasWriteAccess(userId, workspaceId, existing.workspaceId))) {
          return { success: false, error: 'Workflow not found' }
        }

        const result = await performRestoreWorkflow({ workflowId: id, userId, requestId })
        if (!result.success || !result.workflow) {
          return { success: false, error: result.error || 'Failed to restore workflow' }
        }

        logger.info('Workflow restored via restore_resource', { workflowId: id })
        return success({ type, id, name: result.workflow.name }, [
          { type: 'workflow', id, title: result.workflow.name || id },
        ])
      }

      case 'table': {
        const existing = await getTableById(id, { includeArchived: true })
        if (!existing || !(await hasWriteAccess(userId, workspaceId, existing.workspaceId))) {
          return { success: false, error: 'Table not found' }
        }

        const result = await performRestoreTable({ tableId: id, userId, requestId })
        if (!result.success || !result.table) {
          return { success: false, error: result.error || 'Failed to restore table' }
        }

        logger.info('Table restored via restore_resource', { tableId: id, name: result.table.name })
        return success({ type, id, name: result.table.name }, [
          { type: 'table', id, title: result.table.name },
        ])
      }

      case 'file': {
        if (!(await hasWriteAccess(userId, workspaceId, workspaceId))) {
          return { success: false, error: 'File not found' }
        }

        const result = await performRestoreWorkspaceFile({ workspaceId, fileId: id, userId })
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to restore file' }
        }

        const file = await getWorkspaceFile(workspaceId, id)
        const fileName = file?.name || id
        logger.info('File restored via restore_resource', { fileId: id, name: fileName })
        return success({ type, id, name: fileName }, [{ type: 'file', id, title: fileName }])
      }

      case 'knowledgebase': {
        const existing = await getRestorableKnowledgeBase(id)
        if (!existing || !(await hasWriteAccess(userId, workspaceId, existing.workspaceId))) {
          return { success: false, error: 'Knowledge base not found' }
        }

        const result = await performRestoreKnowledgeBase({
          knowledgeBaseId: id,
          userId,
          requestId,
        })
        if (!result.success || !result.knowledgeBase) {
          return { success: false, error: result.error || 'Failed to restore knowledge base' }
        }

        logger.info('Knowledge base restored via restore_resource', { knowledgeBaseId: id })
        return success({ type, id, name: result.knowledgeBase.name }, [
          { type: 'knowledgebase', id, title: result.knowledgeBase.name },
        ])
      }

      case 'folder':
      case 'knowledge_folder':
      case 'table_folder': {
        if (!(await hasWriteAccess(userId, workspaceId, workspaceId))) {
          return { success: false, error: 'Folder not found' }
        }

        const result = await performRestoreFolder({
          folderId: id,
          workspaceId,
          userId,
          resourceType: FOLDER_RESOURCE_TYPE_BY_RESTORABLE[type],
        })
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to restore folder' }
        }

        logger.info('Folder restored via restore_resource', { folderId: id, type })
        return success({ type, id, restoredItems: result.restoredItems })
      }

      case 'file_folder': {
        if (!(await hasWriteAccess(userId, workspaceId, workspaceId))) {
          return { success: false, error: 'File folder not found' }
        }

        const result = await performRestoreWorkspaceFileFolder({
          workspaceId,
          folderId: id,
          userId,
        })
        if (!result.success || !result.folder || !result.restoredItems) {
          return { success: false, error: result.error || 'Failed to restore file folder' }
        }

        logger.info('File folder restored via restore_resource', {
          folderId: id,
          restoredItems: result.restoredItems,
        })
        return success({
          type,
          id,
          name: result.folder.name,
          restoredItems: result.restoredItems,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to restore resource via restore_resource', { type, id, error })
    return { success: false, error: toError(error).message }
  }
}
