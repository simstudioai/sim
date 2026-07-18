import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createAppProjectContract, listAppProjectsContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { assertAppPermission } from '@/lib/apps/permissions'
import { createAppProject, listAppProjects } from '@/lib/apps/projects'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('AppsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return createErrorResponse('Unauthorized', 401)

  const parsed = await parseRequest(listAppProjectsContract, request, {})
  if (!parsed.success) return parsed.response

  const { workspaceId } = parsed.data.query
  const perm = await assertAppPermission(session.user.id, workspaceId, 'edit')
  if (!perm.ok) return createErrorResponse(perm.message, perm.status)

  const projects = await listAppProjects(workspaceId)
  return createSuccessResponse({ projects })
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return createErrorResponse('Unauthorized', 401)

  const origin = getAppOriginStatus()
  if (!origin.enabled) {
    return createErrorResponse(origin.reason, 503, 'APPS_ORIGIN_MISCONFIGURED')
  }

  const parsed = await parseRequest(
    createAppProjectContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    }
  )
  if (!parsed.success) return parsed.response

  const body = parsed.data.body
  const perm = await assertAppPermission(session.user.id, body.workspaceId, 'edit')
  if (!perm.ok) return createErrorResponse(perm.message, perm.status)

  if (body.createdFromChatId) {
    const [chat] = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, body.createdFromChatId),
          eq(copilotChats.userId, session.user.id),
          eq(copilotChats.workspaceId, body.workspaceId),
          eq(copilotChats.type, 'fullstack')
        )
      )
      .limit(1)
    if (!chat) {
      return createErrorResponse('Full-stack chat not found in this workspace', 400)
    }
  }

  const result = await createAppProject({
    workspaceId: body.workspaceId,
    name: body.name,
    slug: body.slug,
    userId: session.user.id,
    createdFromChatId: body.createdFromChatId,
  })

  if (!result.success) {
    return createErrorResponse(result.error, result.status)
  }

  logger.info('Created app project', { projectId: result.project.id })

  try {
    const { AuditAction, AuditResourceType, recordAudit } = await import('@sim/audit')
    recordAudit({
      workspaceId: body.workspaceId,
      actorId: session.user.id,
      action: AuditAction.APP_CREATED,
      resourceType: AuditResourceType.APP,
      resourceId: result.project.id,
      resourceName: result.project.name,
      description: `Created app project ${result.project.name}`,
    })
  } catch {
    // best-effort
  }

  return createSuccessResponse({ project: result.project })
})
