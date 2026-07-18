import { db } from '@sim/db'
import { appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { publishAppReleaseContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { assertAppPermission } from '@/lib/apps/permissions'
import { publishPreparedRelease } from '@/lib/apps/publish'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(publishAppReleaseContract, request, context, {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    })
    if (!parsed.success) return parsed.response

    const { projectId } = parsed.data.params
    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project) return createErrorResponse('Project not found', 404)

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'publish')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const result = await publishPreparedRelease({
      projectId,
      releaseId: parsed.data.body.releaseId,
      expectedVersion: parsed.data.body.expectedVersion,
    })

    if (!result.success) {
      const status =
        result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'TURNSTILE_NOT_CONFIGURED' || result.code === 'APPS_ORIGIN_DISABLED'
            ? 503
            : result.code === 'CONFLICT' ||
                result.code === 'DEPLOYMENT_VERSION_MISSING' ||
                result.code === 'FIXTURE_BUILDS_DISABLED' ||
                result.code === 'ARTIFACT_MISSING' ||
                result.code === 'INVALID_ARTIFACT_HASH'
              ? 409
              : 400
      return createErrorResponse(result.error, status, result.code)
    }

    try {
      const { AuditAction, AuditResourceType, recordAudit } = await import('@sim/audit')
      recordAudit({
        workspaceId: project.workspaceId,
        actorId: session.user.id,
        action: AuditAction.APP_PUBLISHED,
        resourceType: AuditResourceType.APP,
        resourceId: projectId,
        resourceName: project.name,
        description: `Published app release ${result.releaseId}`,
        metadata: { releaseId: result.releaseId },
      })
    } catch {
      // best-effort
    }

    return createSuccessResponse({ releaseId: result.releaseId, state: 'published' })
  }
)
