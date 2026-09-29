import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { dashboardOperations } from '@/lib/dashboards/application/operations'
import { requireDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { DASHBOARD_CONTENT_TYPE, dashboardDisplayName } from '@/lib/dashboards/resource'
import { MAX_DASHBOARD_SOURCE_BYTES, parseDashboardSpec } from '@/lib/dashboards/spec'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  ContentVersionConflictError,
  FileConflictError,
  fetchWorkspaceFileBuffer,
  loadActiveWorkspaceContext,
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

/** A workspace has one dashboard; its backing file keeps this fixed name at the root. */
const DASHBOARD_FILE_NAME = 'Dashboard.dashboard'

export async function dashboardWorkspace(workspaceId: string) {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

export function dashboardRecord(file: WorkspaceFileRecord) {
  return {
    id: file.id,
    type: 'dashboard' as const,
    name: dashboardDisplayName(file.name),
    updatedAt: (file.updatedAt ?? file.uploadedAt).toISOString(),
    revision: workspaceFileRevision(file),
  }
}

/** The unique index guarantees at most one live dashboard per workspace. */
async function findWorkspaceDashboard(workspaceId: string): Promise<WorkspaceFileRecord | null> {
  const { files } = await queryWorkspaceFiles(workspaceId, {
    discovery: 'unlisted',
    contentType: DASHBOARD_CONTENT_TYPE,
    sortBy: 'name',
    sortOrder: 'asc',
    limit: 1,
  })
  return files[0] ?? null
}

function validateContent(content: string) {
  const parsed = parseDashboardSpec(content)
  if (parsed.error) throw new OrchestrationError('validation', parsed.error)
}

/** Reads the workspace dashboard; a workspace without one returns nulls, not an error. */
export const readWorkspaceDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context }) {
    const file = await findWorkspaceDashboard(context.workspaceId)
    if (!file) return { dashboard: null, content: null }
    const content = await fetchWorkspaceFileBuffer(file, { maxBytes: MAX_DASHBOARD_SOURCE_BYTES })
    return { dashboard: dashboardRecord(file), content: content.toString('utf-8') }
  },
})

/**
 * Saves the workspace dashboard. The first save creates it; replacing existing content
 * requires the revision from the last read so a concurrent edit is never overwritten.
 */
export const saveWorkspaceDashboard = defineAuthorizedWorkspaceFileUseCase({
  operation: dashboardOperations.save,
  resolveContext: ({
    input,
  }: {
    input: { workspaceId: string; content: string; expectedRevision?: string }
  }) => dashboardWorkspace(input.workspaceId),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context, principal }) {
    validateContent(input.content)
    const existing = await findWorkspaceDashboard(context.workspaceId)
    if (!existing) {
      if (input.expectedRevision !== undefined)
        throw new OrchestrationError(
          'conflict',
          'The dashboard was deleted after it was read; read it again'
        )
      try {
        const file = await uploadWorkspaceFile(
          context.workspaceId,
          requirePrincipalSubjectUserId(principal),
          Buffer.from(input.content),
          DASHBOARD_FILE_NAME,
          DASHBOARD_CONTENT_TYPE,
          {
            dashboard: true,
            exactName: true,
            discovery: 'unlisted',
            secretProvenance: EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
            notifyWorkspaceChange: false,
          }
        )
        return { dashboard: dashboardRecord(file), created: true }
      } catch (error) {
        if (error instanceof FileConflictError)
          throw new OrchestrationError(
            'conflict',
            'Another save created the dashboard first; read it and save again'
          )
        throw error
      }
    }
    if (input.expectedRevision === undefined)
      throw new OrchestrationError(
        'conflict',
        'This workspace already has a dashboard; read it and pass its revision to replace it'
      )
    try {
      const file = await updateWorkspaceFileContent(
        context.workspaceId,
        existing.id,
        requirePrincipalSubjectUserId(principal),
        Buffer.from(input.content),
        DASHBOARD_CONTENT_TYPE,
        {
          expectedUpdatedAt: parseWorkspaceFileRevision(input.expectedRevision, existing.id),
          version: resolveWorkspaceFileVersionWrite(principal),
          secretProvenancePolicy: { mode: 'preserve' },
        }
      )
      return { dashboard: dashboardRecord(file), created: false }
    } catch (error) {
      if (error instanceof ContentVersionConflictError)
        throw new OrchestrationError('conflict', error.message)
      throw error
    }
  },
  projectAudit: ({ result }) => ({
    action: result.created ? AuditAction.FILE_UPLOADED : AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.dashboard.id,
    resourceName: result.dashboard.name,
    description: result.created ? 'Created dashboard' : 'Updated dashboard YAML',
    metadata: { resourceKind: 'dashboard' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
