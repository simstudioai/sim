import { db } from '@sim/db'
import { appBuild, appProject, appRelease, appRevisionAction } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { deleteAppProjectContract, getAppProjectContract } from '@/lib/api/contracts/apps'
import { parseRequest } from '@/lib/api/server'
import { buildPublicAppUrl, getAppOriginStatus } from '@/lib/apps/origin'
import { assertAppPermission } from '@/lib/apps/permissions'
import { archiveAppProject, getCurrentRelease } from '@/lib/apps/projects'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const GET = withRouteHandler(
  async (_request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(getAppProjectContract, _request, context)
    if (!parsed.success) return parsed.response
    const { projectId } = parsed.data.params
    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project) return createErrorResponse('Project not found', 404)

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'edit')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const currentRelease = await getCurrentRelease(projectId)
    const allReleases = await db
      .select()
      .from(appRelease)
      .where(eq(appRelease.projectId, projectId))
      .orderBy(desc(appRelease.createdAt))

    const draftActions = project.draftRevisionId
      ? await db
          .select({
            actionId: appRevisionAction.actionId,
            workflowId: appRevisionAction.workflowId,
            deploymentVersionId: appRevisionAction.deploymentVersionId,
            outputAllowlist: appRevisionAction.outputAllowlist,
            executionPolicy: appRevisionAction.executionPolicy,
            readOnly: appRevisionAction.readOnly,
          })
          .from(appRevisionAction)
          .where(eq(appRevisionAction.revisionId, project.draftRevisionId))
      : []

    const [latestBuild] = project.draftRevisionId
      ? await db
          .select()
          .from(appBuild)
          .where(
            and(eq(appBuild.projectId, projectId), eq(appBuild.revisionId, project.draftRevisionId))
          )
          .orderBy(desc(appBuild.createdAt))
          .limit(1)
      : [null]

    const origin = getAppOriginStatus()
    let publicUrl: string | null = null
    if (origin.enabled && project.publishedReleaseId) {
      try {
        publicUrl = buildPublicAppUrl(project.publicId, project.slug)
      } catch {
        publicUrl = null
      }
    }

    return createSuccessResponse({
      project,
      publicUrl,
      currentRelease,
      releases: allReleases,
      draftActions,
      latestBuild: latestBuild ?? null,
    })
  }
)

export const DELETE = withRouteHandler(
  async (_request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(deleteAppProjectContract, _request, context)
    if (!parsed.success) return parsed.response
    const { projectId } = parsed.data.params
    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project) return createErrorResponse('Project not found', 404)

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'revoke')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const archived = await archiveAppProject(projectId)
    if (!archived.success) {
      return createErrorResponse(archived.error, 500)
    }

    try {
      const { AuditAction, AuditResourceType, recordAudit } = await import('@sim/audit')
      recordAudit({
        workspaceId: project.workspaceId,
        actorId: session.user.id,
        action: AuditAction.APP_ARCHIVED,
        resourceType: AuditResourceType.APP,
        resourceId: projectId,
        resourceName: project.name,
        description: `Archived app project ${project.name}`,
      })
    } catch {
      // best-effort
    }

    return createSuccessResponse({ archived: true })
  }
)
