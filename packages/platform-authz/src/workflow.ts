import { db, workflow, workflowFolder, workspace } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from './workspace'

export type { PermissionType }

export type ActiveWorkflowRecord = typeof workflow.$inferSelect

export interface ActiveWorkflowContext {
  workflow: ActiveWorkflowRecord
  workspaceId: string
  workspaceOrganizationId: string | null
}

export async function getActiveWorkflowContext(
  workflowId: string
): Promise<ActiveWorkflowContext | null> {
  const rows = await db
    .select({
      workflow,
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .where(
      and(eq(workflow.id, workflowId), isNull(workflow.archivedAt), isNull(workspace.archivedAt))
    )
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return {
    workflow: rows[0].workflow,
    workspaceId: rows[0].workspaceId,
    workspaceOrganizationId: rows[0].workspaceOrganizationId,
  }
}

export async function getActiveWorkflowRecord(
  workflowId: string
): Promise<ActiveWorkflowRecord | null> {
  const context = await getActiveWorkflowContext(workflowId)
  return context?.workflow ?? null
}

export async function assertActiveWorkflowContext(
  workflowId: string
): Promise<ActiveWorkflowContext> {
  const context = await getActiveWorkflowContext(workflowId)
  if (!context) {
    throw new Error(`Active workflow not found: ${workflowId}`)
  }
  return context
}

type WorkflowRecord = typeof workflow.$inferSelect

export class WorkflowLockedError extends Error {
  readonly status = 423

  constructor(message = 'Workflow is locked') {
    super(message)
    this.name = 'WorkflowLockedError'
  }
}

export class FolderLockedError extends Error {
  readonly status = 423

  constructor(message = 'Folder is locked') {
    super(message)
    this.name = 'FolderLockedError'
  }
}

export interface LockStatus {
  locked: boolean
  directLocked: boolean
  inheritedLocked: boolean
  lockedBy: 'workflow' | 'folder' | null
  lockedFolderId: string | null
}

export async function getFolderLockStatus(folderId: string | null): Promise<LockStatus> {
  if (!folderId) {
    return {
      locked: false,
      directLocked: false,
      inheritedLocked: false,
      lockedBy: null,
      lockedFolderId: null,
    }
  }

  let currentFolderId: string | null = folderId
  let isDirect = true
  const visited = new Set<string>()

  while (currentFolderId && !visited.has(currentFolderId)) {
    visited.add(currentFolderId)
    const [folder] = await db
      .select({
        id: workflowFolder.id,
        parentId: workflowFolder.parentId,
        locked: workflowFolder.locked,
      })
      .from(workflowFolder)
      .where(and(eq(workflowFolder.id, currentFolderId), isNull(workflowFolder.archivedAt)))
      .limit(1)

    if (!folder) break
    if (folder.locked) {
      return {
        locked: true,
        directLocked: isDirect,
        inheritedLocked: !isDirect,
        lockedBy: 'folder',
        lockedFolderId: folder.id,
      }
    }

    currentFolderId = folder.parentId
    isDirect = false
  }

  return {
    locked: false,
    directLocked: false,
    inheritedLocked: false,
    lockedBy: null,
    lockedFolderId: null,
  }
}

export async function getWorkflowLockStatus(workflowId: string): Promise<LockStatus> {
  const [wf] = await db
    .select({
      locked: workflow.locked,
      folderId: workflow.folderId,
    })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)

  if (!wf) {
    return {
      locked: false,
      directLocked: false,
      inheritedLocked: false,
      lockedBy: null,
      lockedFolderId: null,
    }
  }

  if (wf.locked) {
    return {
      locked: true,
      directLocked: true,
      inheritedLocked: false,
      lockedBy: 'workflow',
      lockedFolderId: null,
    }
  }

  return getFolderLockStatus(wf.folderId)
}

export async function assertWorkflowMutable(workflowId: string): Promise<void> {
  const status = await getWorkflowLockStatus(workflowId)
  if (status.locked) {
    throw new WorkflowLockedError(
      status.lockedBy === 'folder'
        ? 'Workflow is locked by its containing folder'
        : 'Workflow is locked'
    )
  }
}

export async function assertFolderMutable(folderId: string | null): Promise<void> {
  const status = await getFolderLockStatus(folderId)
  if (status.locked) {
    throw new FolderLockedError(
      status.inheritedLocked ? 'Folder is locked by an ancestor folder' : 'Folder is locked'
    )
  }
}

export class FolderNotFoundError extends Error {
  readonly status = 400

  constructor(message = 'Target folder not found') {
    super(message)
    this.name = 'FolderNotFoundError'
  }
}

/**
 * Resolves whether a folder may be assigned to a workflow in the given workspace:
 * it must exist, not be archived, and belong to that same workspace. A null/undefined
 * folderId (the workspace root) is always allowed. Guards against cross-workspace
 * folder references when a workflow's `folderId` is set from request input.
 */
export async function isFolderInWorkspace(
  folderId: string | null | undefined,
  workspaceId: string
): Promise<boolean> {
  if (!folderId) return true

  const [folder] = await db
    .select({
      workspaceId: workflowFolder.workspaceId,
      archivedAt: workflowFolder.archivedAt,
    })
    .from(workflowFolder)
    .where(eq(workflowFolder.id, folderId))
    .limit(1)

  return Boolean(folder && folder.workspaceId === workspaceId && !folder.archivedAt)
}

/**
 * Throws {@link FolderNotFoundError} (HTTP 400) when `folderId` does not belong to
 * `workspaceId` (or is archived/missing). No-op for a null/undefined folderId.
 */
export async function assertFolderInWorkspace(
  folderId: string | null | undefined,
  workspaceId: string
): Promise<void> {
  if (!(await isFolderInWorkspace(folderId, workspaceId))) {
    throw new FolderNotFoundError()
  }
}

export interface WorkflowWorkspaceAuthorizationResult {
  allowed: boolean
  status: number
  message?: string
  workflow: WorkflowRecord | null
  workspacePermission: PermissionType | null
}

export async function authorizeWorkflowByWorkspacePermission(params: {
  workflowId: string
  userId: string
  action?: 'read' | 'write' | 'admin'
}): Promise<WorkflowWorkspaceAuthorizationResult> {
  const { workflowId, userId, action = 'read' } = params

  const activeContext = await getActiveWorkflowContext(workflowId)
  if (!activeContext) {
    return {
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
    }
  }

  const wf = activeContext.workflow

  if (!wf.workspaceId) {
    return {
      allowed: false,
      status: 403,
      message:
        'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
      workflow: wf,
      workspacePermission: null,
    }
  }

  const workspacePermission = await resolveEffectiveWorkspacePermission(
    userId,
    wf.workspaceId,
    activeContext.workspaceOrganizationId
  )

  if (!permissionSatisfies(workspacePermission, action)) {
    return {
      allowed: false,
      status: 403,
      message: `Unauthorized: Access denied to ${action} this workflow`,
      workflow: wf,
      workspacePermission,
    }
  }

  return {
    allowed: true,
    status: 200,
    workflow: wf,
    workspacePermission,
  }
}
