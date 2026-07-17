import { db } from '@sim/db'
import { workflowInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getInterfaceDeploymentStatusContract } from '@/lib/api/contracts/interfaces'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('InterfaceStatusAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const parsed = await parseRequest(getInterfaceDeploymentStatusContract, request, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const requestId = generateRequestId()

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return createErrorResponse('Unauthorized', 401)
      }

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: id,
        userId: auth.userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return createErrorResponse(
          authorization.message || 'Access denied',
          authorization.status || 403
        )
      }

      const deploymentResults = await db
        .select({
          id: workflowInterface.id,
          identifier: workflowInterface.identifier,
          title: workflowInterface.title,
          description: workflowInterface.description,
          customizations: workflowInterface.customizations,
          authType: workflowInterface.authType,
          outputConfigs: workflowInterface.outputConfigs,
          isActive: workflowInterface.isActive,
          spec: workflowInterface.spec,
        })
        .from(workflowInterface)
        .where(and(eq(workflowInterface.workflowId, id), isNull(workflowInterface.archivedAt)))
        .limit(1)

      const isDeployed = deploymentResults.length > 0 && deploymentResults[0].isActive
      const deploymentInfo =
        deploymentResults.length > 0
          ? {
              id: deploymentResults[0].id,
              identifier: deploymentResults[0].identifier,
              title: deploymentResults[0].title,
              description: deploymentResults[0].description,
              customizations: deploymentResults[0].customizations,
              authType: deploymentResults[0].authType,
              outputConfigs: deploymentResults[0].outputConfigs,
              spec: deploymentResults[0].spec,
            }
          : null

      return createSuccessResponse({
        isDeployed,
        deployment: deploymentInfo,
      })
    } catch (error: unknown) {
      logger.error(`[${requestId}] Error checking interface deployment status:`, error)
      return createErrorResponse('Failed to check interface deployment status', 500)
    }
  }
)
