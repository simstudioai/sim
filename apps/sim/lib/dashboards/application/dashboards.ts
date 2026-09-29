import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { dashboardOperations } from '@/lib/dashboards/application/operations'
import { requireDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import {
  type DashboardRow,
  getWorkspaceDashboard,
  insertWorkspaceDashboard,
  updateDashboardContent,
} from '@/lib/dashboards/repository'
import { parseDashboardSpec } from '@/lib/dashboards/spec'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const authorizationOptions = {
  delegation: { audience: 'sim:workspaces', isWithinScope: () => true },
} as const

export function dashboardRecord(row: DashboardRow) {
  return {
    id: row.id,
    type: 'dashboard' as const,
    name: 'Dashboard',
    updatedAt: row.updatedAt.toISOString(),
    revision: String(row.revision),
  }
}

function validateContent(content: string) {
  const parsed = parseDashboardSpec(content)
  if (parsed.error) throw new OrchestrationError('validation', parsed.error)
}

/** Revisions are PostgreSQL integers; anything else cannot be a revision from a read. */
const MAX_REVISION = 2_147_483_647

function parseRevision(revision: string): number {
  const parsed = /^\d+$/.test(revision) ? Number(revision) : Number.NaN
  if (!(parsed >= 1 && parsed <= MAX_REVISION))
    throw new OrchestrationError('validation', 'expectedRevision must be the revision from a read')
  return parsed
}

/** Reads the workspace dashboard; a workspace without one returns nulls, not an error. */
export const readWorkspaceDashboard = defineAuthorizedWorkspaceUseCase({
  operation: dashboardOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ context }) {
    const row = await getWorkspaceDashboard(context.workspaceId)
    if (!row) return { dashboard: null, content: null }
    return { dashboard: dashboardRecord(row), content: row.content }
  },
})

/**
 * Saves the workspace dashboard. The first save creates it; replacing existing content
 * requires the revision from the last read so a concurrent edit is never overwritten.
 */
export const saveWorkspaceDashboard = defineAuthorizedWorkspaceUseCase({
  operation: dashboardOperations.save,
  resolveContext: ({
    input,
  }: {
    input: { workspaceId: string; content: string; expectedRevision?: string }
  }) => resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context, principal }) {
    validateContent(input.content)
    const userId = requirePrincipalSubjectUserId(principal)
    if (input.expectedRevision === undefined) {
      const created = await insertWorkspaceDashboard(context.workspaceId, input.content, userId)
      if (!created)
        throw new OrchestrationError(
          'conflict',
          'This workspace already has a dashboard; read it and pass its revision to replace it'
        )
      return { dashboard: dashboardRecord(created), created: true }
    }
    const revision = parseRevision(input.expectedRevision)
    const existing = await getWorkspaceDashboard(context.workspaceId)
    if (!existing)
      throw new OrchestrationError(
        'conflict',
        'The dashboard was deleted after it was read; read it again'
      )
    const updated = await updateDashboardContent(existing.id, input.content, userId, revision)
    if (!updated)
      throw new OrchestrationError(
        'conflict',
        'The dashboard changed after it was read; read it again and reapply your edit'
      )
    return { dashboard: dashboardRecord(updated), created: false }
  },
  projectAudit: ({ result }) => ({
    action: result.created ? AuditAction.DASHBOARD_CREATED : AuditAction.DASHBOARD_UPDATED,
    resourceType: AuditResourceType.DASHBOARD,
    resourceId: result.dashboard.id,
    resourceName: result.dashboard.name,
    description: result.created ? 'Created dashboard' : 'Updated dashboard',
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
