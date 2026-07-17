import { db } from '@sim/db'
import { workflowInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createInterfaceContract } from '@/lib/api/contracts/interfaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performInterfaceDeploy } from '@/lib/interfaces/orchestration/interface-deploy'
import { checkWorkflowAccessForInterfaceCreation } from '@/app/api/interfaces/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('InterfaceAPI')

export const GET = withRouteHandler(async (_request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const deployments = await db
      .select()
      .from(workflowInterface)
      .where(
        and(eq(workflowInterface.userId, session.user.id), isNull(workflowInterface.archivedAt))
      )

    return createSuccessResponse({ deployments })
  } catch (error) {
    logger.error('Error fetching interface deployments:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to fetch interface deployments'), 500)
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const parsed = await parseRequest(
      createInterfaceContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const access = await checkWorkflowAccessForInterfaceCreation(body.workflowId, session.user.id)
    if (!access.hasAccess) {
      return createErrorResponse('Access denied', 403)
    }

    const result = await performInterfaceDeploy({
      workflowId: body.workflowId,
      userId: session.user.id,
      identifier: body.identifier,
      title: body.title,
      description: body.description,
      customizations: body.customizations,
      authType: 'public',
      outputConfigs: body.outputConfigs,
      spec: body.spec,
      versionDescription: body.versionDescription,
      versionName: body.versionName,
      workspaceId: access.workflow?.workspaceId,
    })

    if (!result.success) {
      return createErrorResponse(result.error || 'Failed to deploy interface', 400)
    }

    return createSuccessResponse({
      id: result.interfaceId,
      interfaceId: result.interfaceId,
      interfaceUrl: result.interfaceUrl,
      message: 'Interface deployed successfully',
    })
  } catch (error) {
    logger.error('Error deploying interface:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to deploy interface'), 500)
  }
})
