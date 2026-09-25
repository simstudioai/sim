import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { dashboardOperations } from '@/lib/dashboards/application/operations'
import { requireDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { DASHBOARD_CONTENT_TYPE, dashboardDisplayName } from '@/lib/dashboards/resource'
import { parseDashboardSpec } from '@/lib/dashboards/spec'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  ContentVersionConflictError,
  deleteWorkspaceFile,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  loadActiveWorkspaceContext,
  moveRenameWorkspaceFile,
  queryWorkspaceFiles,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import {
  parseWorkspaceFileRevision,
  workspaceFileRevision,
} from '@/lib/workspace-files/application/file-revision'
import { resolveWorkspaceFileVersionWrite } from '@/lib/workspace-files/application/file-version-write'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface DashboardTarget {
  workspaceId: string
  dashboardId: string
}

export async function dashboardWorkspace(workspaceId: string) {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function dashboardContext(input: DashboardTarget) {
  const context = await resolveActiveWorkspaceFileContext({
    fileId: input.dashboardId,
    assertedWorkspaceId: input.workspaceId,
  })
  return context
}

async function requireDashboardFile(workspaceId: string, dashboardId: string) {
  const file = await getWorkspaceFile(workspaceId, dashboardId, { throwOnError: true })
  if (!file || file.type !== DASHBOARD_CONTENT_TYPE)
    throw new OrchestrationError('not_found', 'Dashboard not found')
  return file
}

export function dashboardRecord(file: WorkspaceFileRecord) {
  return {
    id: file.id,
    type: 'dashboard' as const,
    name: dashboardDisplayName(file.name),
    folderId: file.folderId ?? null,
    path: `dashboards/${file.folderPath ? `${file.folderPath}/` : ''}${dashboardDisplayName(file.name)}`,
    updatedAt: (file.updatedAt ?? file.uploadedAt).toISOString(),
    revision: workspaceFileRevision(file),
  }
}

function validateContent(content: string) {
  const parsed = parseDashboardSpec(content)
  if (parsed.error) throw new OrchestrationError('validation', parsed.error)
}

function storageName(name: string) {
  const clean = name.trim().replace(/\.dashboard$/, '')
  if (!clean || clean.length > 220 || /[/\\]/.test(clean) || clean === '.' || clean === '..') {
    throw new OrchestrationError(
      'validation',
      'Dashboard name must be 1–220 characters without slashes'
    )
  }
  return `${clean}.dashboard`
}

export const listDashboards = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.list,
  resolveContext: ({ input }: { input: { workspaceId: string; search?: string } }) =>
    dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const { files, nextKeys } = await queryWorkspaceFiles(context.workspaceId, {
      discovery: 'unlisted',
      contentType: DASHBOARD_CONTENT_TYPE,
      search: input.search,
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 500,
    })
    return { dashboards: files.map(dashboardRecord), truncated: nextKeys !== null }
  },
})

export const readDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.read,
  resolveContext: ({ input }: { input: DashboardTarget }) => dashboardContext(input),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context }) {
    const file = await requireDashboardFile(context.workspaceId, context.fileId)
    const content = await fetchWorkspaceFileBuffer(file, { maxBytes: 128 * 1024 })
    return { dashboard: dashboardRecord(file), content: content.toString('utf-8') }
  },
})

export const createDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.create,
  resolveContext: ({
    input,
  }: {
    input: { workspaceId: string; name: string; content: string; folderId?: string | null }
  }) => dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context, principal }) {
    validateContent(input.content)
    const file = await uploadWorkspaceFile(
      context.workspaceId,
      requirePrincipalSubjectUserId(principal),
      Buffer.from(input.content),
      storageName(input.name),
      DASHBOARD_CONTENT_TYPE,
      {
        folderId: input.folderId,
        exactName: true,
        discovery: 'unlisted',
        secretProvenance: EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
        notifyWorkspaceChange: false,
      }
    )
    return { dashboard: dashboardRecord(file) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_UPLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.dashboard.id,
    resourceName: result.dashboard.name,
    description: 'Created dashboard',
    metadata: { resourceKind: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})

export const updateDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.update,
  resolveContext: ({
    input,
  }: {
    input: DashboardTarget & { content: string; expectedRevision: string }
  }) => dashboardContext(input),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context, principal }) {
    await requireDashboardFile(context.workspaceId, context.fileId)
    validateContent(input.content)
    try {
      const file = await updateWorkspaceFileContent(
        context.workspaceId,
        context.fileId,
        requirePrincipalSubjectUserId(principal),
        Buffer.from(input.content),
        DASHBOARD_CONTENT_TYPE,
        {
          expectedUpdatedAt: parseWorkspaceFileRevision(input.expectedRevision, context.fileId),
          version: resolveWorkspaceFileVersionWrite(principal),
          secretProvenancePolicy: { mode: 'preserve' },
        }
      )
      return { dashboard: dashboardRecord(file) }
    } catch (error) {
      if (error instanceof ContentVersionConflictError)
        throw new OrchestrationError('conflict', error.message)
      throw error
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.dashboard.id,
    resourceName: result.dashboard.name,
    description: 'Updated dashboard YAML',
    metadata: { resourceKind: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})

/** Rename and move form one storage mutation. Omitted values retain current metadata. */
export const moveDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.move,
  resolveContext: ({
    input,
  }: {
    input: DashboardTarget & { name?: string; folderId?: string | null }
  }) => dashboardContext(input),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const file = await requireDashboardFile(context.workspaceId, context.fileId)
    const result = await moveRenameWorkspaceFile({
      workspaceId: context.workspaceId,
      fileId: context.fileId,
      newName: input.name === undefined ? file.name : storageName(input.name),
      targetFolderId: input.folderId === undefined ? (file.folderId ?? null) : input.folderId,
    })
    return { dashboard: dashboardRecord(result.file), changed: result.renamed || result.moved }
  },
  projectAudit: ({ result }) =>
    result.changed
      ? [
          {
            action: AuditAction.FILE_UPDATED,
            resourceType: AuditResourceType.FILE,
            resourceId: result.dashboard.id,
            resourceName: result.dashboard.name,
            description: 'Moved or renamed dashboard',
            metadata: { resourceKind: 'dashboard' },
          },
        ]
      : [],
  afterSuccess: async ({ context, result }) => {
    if (result.changed) await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

export const deleteDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.delete,
  resolveContext: ({ input }: { input: DashboardTarget }) => dashboardContext(input),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context }) {
    await requireDashboardFile(context.workspaceId, context.fileId)
    await deleteWorkspaceFile(context.workspaceId, context.fileId)
    return { deleted: true as const, id: context.fileId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_DELETED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.id,
    description: 'Deleted dashboard',
    metadata: { resourceKind: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
