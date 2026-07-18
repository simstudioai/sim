import { db } from '@sim/db'
import { appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { revokeAppReleaseContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { assertAppPermission } from '@/lib/apps/permissions'
import { revokeRelease } from '@/lib/apps/publish'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(revokeAppReleaseContract, request, context, {
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

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'revoke')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const result = await revokeRelease({
      projectId,
      releaseId: parsed.data.body.releaseId,
    })

    if (!result.success) {
      return createErrorResponse(result.error, 400)
    }

    try {
      const { AuditAction, AuditResourceType, recordAudit } = await import('@sim/audit')
      recordAudit({
        workspaceId: project.workspaceId,
        actorId: session.user.id,
        action: AuditAction.APP_REVOKED,
        resourceType: AuditResourceType.APP,
        resourceId: projectId,
        resourceName: project.name,
        description: `Revoked app release ${parsed.data.body.releaseId}`,
        metadata: {
          releaseId: parsed.data.body.releaseId,
          clearedPointer: result.clearedPointer,
        },
      })
    } catch {
      // best-effort
    }

    // CDN HTML purge is idempotent post-commit work (host/CDN layer).
    return createSuccessResponse({
      revoked: true,
      clearedPointer: result.clearedPointer,
      tombstone: result.clearedPointer,
    })
  }
)
