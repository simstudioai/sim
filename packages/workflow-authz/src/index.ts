import {
  db,
  permissions,
  type permissionTypeEnum,
  workflow,
  workflowFolder,
  workspace,
} from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'

export type ActiveWorkflowRecord = typeof workflow.$inferSelect

export interface ActiveWorkflowContext {
  workflow: ActiveWorkflowRecord
  workspaceId: string
}

export async function getActiveWorkflowContext(
  workflowId: string
): Promise<ActiveWorkflowContext | null> {
  const rows = await db
    .select({
      workflow,
      workspaceId: workspace.id,
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

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

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

  const [permissionRow] = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, wf.workspaceId)
      )
    )
    .limit(1)

  const workspacePermission = (permissionRow?.permissionType as PermissionType | undefined) ?? null

  if (workspacePermission === null) {
    return {
      allowed: false,
      status: 403,
      message: `Unauthorized: Access denied to ${action} this workflow`,
      workflow: wf,
      workspacePermission,
    }
  }

  const permissionSatisfied =
    action === 'read'
      ? true
      : action === 'write'
        ? workspacePermission === 'write' || workspacePermission === 'admin'
        : workspacePermission === 'admin'

  if (!permissionSatisfied) {
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
