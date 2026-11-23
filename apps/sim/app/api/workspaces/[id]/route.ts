import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteWorkspaceBodySchema,
  updateWorkspaceContract,
  updateWorkspacePutContract,
} from '@/lib/api/contracts'
import { validationErrorResponse } from '@/lib/api/server'
import { orchestrationFailureResponse } from '@/lib/api/server/orchestration-response'
import {
  defineInternalJsonRoute,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'
import { captureServerEvent } from '@/lib/posthog/server'
import { workspaceUpdateOperations } from '@/lib/workspaces/application/operations'
import { updateWorkspace } from '@/lib/workspaces/application/update-workspace'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'
import { presentWorkspace } from '@/lib/workspaces/response'

const logger = createLogger('WorkspaceByIdAPI')

import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deliverRunStops } from '@/lib/mothership/request/application/stop-delivery'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { WorkspaceUpdatePatch, WorkspaceUpdateResult } from '@/lib/workspaces/update'

export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = id

    // Check if user has any access to this workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    // Get workspace details
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    return NextResponse.json({
      workspace: {
        ...presentWorkspace(workspaceDetails),
        permissions: userPermission,
      },
    })
  }
)

const updateWorkspaceErrorPolicy: InternalErrorPolicy = {
  project: (error) =>
    error instanceof NoWorkspaceAccessError ||
    error instanceof InsufficientWorkspacePermissionsError
      ? internalErrorResponse(403, { error: 'Insufficient permissions' })
      : internalOrchestrationErrorPolicy.project(error),
  unhandled: () => internalErrorResponse(500, { error: 'Failed to update workspace' }),
}

const updateWorkspaceRoute = {
  auth: internalSessionAuth,
  operation: workspaceUpdateOperations.update,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing workspace update admission' }),
  errorPolicy: updateWorkspaceErrorPolicy,
  mapInput: ({ params, body }: { params: { id: string }; body: WorkspaceUpdatePatch }) => ({
    workspaceId: params.id,
    patch: body,
  }),
  useCase: updateWorkspace,
  /** Only a workspace admin reaches a successful update, so the caller's role is known. */
  present: ({ updated }: WorkspaceUpdateResult) => ({
    workspace: { ...presentWorkspace(updated), permissions: 'admin' as const },
  }),
}

export const PATCH = defineInternalJsonRoute({
  contract: updateWorkspaceContract,
  ...updateWorkspaceRoute,
})

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = id
    const rawBody = await request.json().catch(() => ({}))
    const bodyValidation = deleteWorkspaceBodySchema.safeParse(rawBody)
    if (!bodyValidation.success) return validationErrorResponse(bodyValidation.error)

    // Check if user has admin permissions to delete workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const [[workspaceRecord], totalWorkspaces] = await Promise.all([
        db
          .select({ name: workspace.name })
          .from(workspace)
          .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
          .limit(1),
        db
          .select({ id: permissions.entityId })
          .from(permissions)
          .innerJoin(workspace, eq(permissions.entityId, workspace.id))
          .where(
            and(
              eq(permissions.userId, session.user.id),
              eq(permissions.entityType, 'workspace'),
              isNull(workspace.archivedAt)
            )
          ),
      ])

      /** Counts all workspace memberships (any role), not just admin — prevents the user from reaching a zero-workspace state. */
      if (totalWorkspaces.length <= 1) {
        return NextResponse.json({ error: 'Cannot delete the only workspace' }, { status: 400 })
      }

      logger.info(`Deleting workspace ${workspaceId} for user ${session.user.id}`)

      const workspaceWorkflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      const workflowIds = workspaceWorkflows.map((entry) => entry.id)

      const archiveResult = await archiveWorkspace(workspaceId, {
        requestId: `workspace-${workspaceId}`,
        deliverStops: deliverRunStops,
      })

      /** Recorded first: a retry that finishes an earlier partial deletion still archives it. */
      if (archiveResult.archivedProject) {
        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.PROJECT_ARCHIVED,
          resourceType: AuditResourceType.PROJECT,
          resourceId: archiveResult.archivedProject.id,
          resourceName: archiveResult.archivedProject.name,
          description: `Archived Project "${archiveResult.archivedProject.name}" with its last active environment`,
          request,
        })
      }

      if (!archiveResult.archived && !workspaceRecord) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.WORKSPACE_DELETED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: workspaceRecord?.name,
        description: `Archived workspace "${workspaceRecord?.name || workspaceId}"`,
        metadata: {
          affected: {
            workflows: workflowIds.length,
          },
          archived: archiveResult.archived,
        },
        request,
      })

      captureServerEvent(
        session.user.id,
        'workspace_deleted',
        { workspace_id: workspaceId, workflow_count: workflowIds.length },
        { groups: { workspace: workspaceId } }
      )

      return NextResponse.json({ success: true })
    } catch (error) {
      const failure = orchestrationFailureResponse(error, 'Failed to delete workspace')
      if (failure) return failure
      logger.error(`Error deleting workspace ${workspaceId}:`, error)
      return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
    }
  }
)

export const PUT = defineInternalJsonRoute({
  contract: updateWorkspacePutContract,
  ...updateWorkspaceRoute,
})
