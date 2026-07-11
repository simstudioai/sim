import { db, folder, workflow, workspace } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'
import {
  getFolderLockStatus as getGenericFolderLockStatus,
  ResourceLockedError,
} from './resource-lock'
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

/**
 * Workflow-flavored subclass of the generic {@link ResourceLockedError} so
 * existing `instanceof WorkflowLockedError` catch blocks (~30 call sites)
 * keep working unchanged after the locking engine was consolidated into
 * `resource-lock.ts`.
 */
export class WorkflowLockedError extends ResourceLockedError {
  constructor(message = 'Workflow is locked') {
    super('workflow', false, message)
    this.name = 'WorkflowLockedError'
  }
}

export class FolderLockedError extends ResourceLockedError {
  constructor(message = 'Folder is locked', inherited = false) {
    super('workflow', inherited, message)
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

function toWorkflowLockStatus(
  status: Awaited<ReturnType<typeof getGenericFolderLockStatus>>
): LockStatus {
  return {
    ...status,
    lockedBy: status.lockedBy === 'resource' ? 'workflow' : status.lockedBy,
  }
}

/**
 * Thin `resourceType: 'workflow'` wrapper over the generic folder-chain walk
 * in `resource-lock.ts` — kept so the ~30 existing call sites importing from
 * `@sim/platform-authz/workflow` don't need a rename sweep.
 */
export async function getFolderLockStatus(folderId: string | null): Promise<LockStatus> {
  return toWorkflowLockStatus(await getGenericFolderLockStatus(folderId, 'workflow'))
}

/**
 * Checks `workflow.locked` on the row itself (only for a live, non-archived
 * workflow — archived workflows are expected to already have been rejected
 * upstream by `getActiveWorkflowContext`), falling back to the folder chain.
 */
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
      status.inheritedLocked ? 'Folder is locked by an ancestor folder' : 'Folder is locked',
      status.inheritedLocked
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

  const [folderRow] = await db
    .select({
      workspaceId: folder.workspaceId,
      deletedAt: folder.deletedAt,
    })
    .from(folder)
    .where(and(eq(folder.id, folderId), eq(folder.resourceType, 'workflow')))
    .limit(1)

  return Boolean(folderRow && folderRow.workspaceId === workspaceId && !folderRow.deletedAt)
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
