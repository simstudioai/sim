import { db } from '@sim/db'
import { appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertAppPermission } from '@/lib/apps/permissions'
import { publishProjectWithDeploy } from '@/lib/apps/publish-with-deploy'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const bodySchema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
})

export const maxDuration = 3600

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const { projectId } = await context.params

    let body: z.infer<typeof bodySchema> = {}
    try {
      const json = await request.json().catch(() => ({}))
      body = bodySchema.parse(json)
    } catch {
      return createErrorResponse('Invalid request body', 400, 'VALIDATION_ERROR')
    }

    const [project] = await db
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)

    if (!project) return createErrorResponse('Project not found', 404)

    const perm = await assertAppPermission(session.user.id, project.workspaceId, 'publish')
    if (!perm.ok) return createErrorResponse(perm.message, perm.status)

    const result = await publishProjectWithDeploy({
      projectId,
      userId: session.user.id,
      expectedVersion: body.expectedVersion,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          ...(result.partialDeployments ? { partialDeployments: result.partialDeployments } : {}),
        },
        { status: result.status }
      )
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
        description: `Published app with deploy for release ${result.releaseId}`,
        metadata: {
          releaseId: result.releaseId,
          deployments: result.deployments,
        },
      })
    } catch {
      // best-effort
    }

    return createSuccessResponse({
      releaseId: result.releaseId,
      revisionId: result.revisionId,
      buildId: result.buildId,
      deployments: result.deployments,
      state: 'published',
    })
  }
)
