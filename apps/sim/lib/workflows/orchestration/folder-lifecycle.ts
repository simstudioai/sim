import type { folder as folderTable } from '@sim/db/schema'
import { createFolder, deleteFolder, restoreFolder, updateFolder } from '@/lib/folders/lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

/**
 * Workflow-bound entry points into the generic folder engine in `lib/folders/lifecycle.ts`.
 *
 * The engine is resourceType-driven and owns the actual writes; these wrappers exist so the
 * workflow callers that predate it (the folders API, the copilot workflow tools, the
 * resource-restore orchestrator) keep a single, workflow-shaped signature. Everything that
 * differs for workflows — the last-workflow delete guard, archiving through the workflow
 * lifecycle so deployments and webhooks tear down, and restoring schedules/webhooks/chats —
 * is declared as data on the `workflow` entry of `FOLDER_RESOURCES`, not branched on here.
 */

export interface PerformCreateFolderParams {
  userId: string
  workspaceId: string
  name: string
  id?: string
  parentId?: string | null
  sortOrder?: number
}

export interface PerformCreateFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: typeof folderTable.$inferSelect
}

export interface PerformUpdateFolderParams {
  folderId: string
  workspaceId: string
  userId: string
  name?: string
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export interface PerformUpdateFolderResult extends PerformCreateFolderResult {}

export interface PerformDeleteFolderParams {
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

export interface PerformDeleteFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  deletedItems?: { folders: number; workflows?: number }
}

export interface PerformRestoreFolderParams extends PerformDeleteFolderParams {}

export interface PerformRestoreFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  restoredItems?: { folders: number; workflows?: number }
}

export function performCreateFolder(
  params: PerformCreateFolderParams
): Promise<PerformCreateFolderResult> {
  return createFolder({ ...params, resourceType: 'workflow' })
}

export function performUpdateFolder(
  params: PerformUpdateFolderParams
): Promise<PerformUpdateFolderResult> {
  return updateFolder({ ...params, resourceType: 'workflow' })
}

export function performDeleteFolder(
  params: PerformDeleteFolderParams
): Promise<PerformDeleteFolderResult> {
  return deleteFolder({ ...params, resourceType: 'workflow' })
}

export function performRestoreFolder(
  params: PerformRestoreFolderParams
): Promise<PerformRestoreFolderResult> {
  return restoreFolder({ ...params, resourceType: 'workflow' })
}
