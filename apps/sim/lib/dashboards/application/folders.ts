import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { dashboardWorkspace } from '@/lib/dashboards/application/dashboards'
import { dashboardOperations } from '@/lib/dashboards/application/operations'
import { requireDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import {
  createFolderAtPathTransition,
  deleteFolderByPathTransition,
  relocateFolderByPathTransition,
} from '@/lib/folders/orchestration'
import { listFoldersForWorkspace, toFolderApi } from '@/lib/folders/queries'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'

interface FolderTarget {
  workspaceId: string
  path: string
}

export const listDashboardFolders = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.folders,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context }) {
    const folders = await listFoldersForWorkspace(context.workspaceId, 'active', 'dashboard')
    return { folders }
  },
})

export const createDashboardFolder = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.createFolder,
  resolveContext: ({ input }: { input: FolderTarget }) => dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context, input, principal }) {
    const result = await createFolderAtPathTransition({
      workspaceId: context.workspaceId,
      resourceType: 'dashboard',
      userId: requirePrincipalSubjectUserId(principal),
      path: input.path,
      effects: false,
      throwInfrastructure: true,
    })
    if (!result.success || !result.folder)
      throw new OrchestrationError(
        result.errorCode ?? 'internal',
        result.error ?? 'Folder creation failed'
      )
    return { folder: toFolderApi(result.folder) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FOLDER_CREATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.folder.id,
    resourceName: result.folder.name,
    metadata: { folderResourceType: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})

export const moveDashboardFolder = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.moveFolder,
  resolveContext: ({ input }: { input: FolderTarget & { destinationPath: string } }) =>
    dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context, input, principal }) {
    const result = await relocateFolderByPathTransition({
      workspaceId: context.workspaceId,
      resourceType: 'dashboard',
      userId: requirePrincipalSubjectUserId(principal),
      path: input.path,
      destinationPath: input.destinationPath,
      effects: false,
      throwInfrastructure: true,
    })
    if (!result.success || !result.folder)
      throw new OrchestrationError(
        result.errorCode ?? 'internal',
        result.error ?? 'Folder move failed'
      )
    return { folder: toFolderApi(result.folder) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FOLDER_UPDATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.folder.id,
    resourceName: result.folder.name,
    metadata: { folderResourceType: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})

export const deleteDashboardFolder = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.deleteFolder,
  resolveContext: ({ input }: { input: FolderTarget }) => dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context, input, principal }) {
    const result = await deleteFolderByPathTransition({
      workspaceId: context.workspaceId,
      resourceType: 'dashboard',
      userId: requirePrincipalSubjectUserId(principal),
      path: input.path,
      recursive: true,
      effects: false,
      throwInfrastructure: true,
    })
    if (!result.success || !result.folderId)
      throw new OrchestrationError(
        result.errorCode ?? 'internal',
        result.error ?? 'Folder deletion failed'
      )
    return { deleted: true as const, id: result.folderId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FOLDER_DELETED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.id,
    metadata: { folderResourceType: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
