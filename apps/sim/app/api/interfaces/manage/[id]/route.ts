import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { deleteInterfaceContract, updateInterfaceContract } from '@/lib/api/contracts/interfaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performInterfaceDeploy,
  performInterfaceUndeploy,
} from '@/lib/interfaces/orchestration/interface-deploy'
import { checkInterfaceAccess } from '@/app/api/interfaces/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('InterfaceManageAPI')

export const GET = withRouteHandler(
  async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session) return createErrorResponse('Unauthorized', 401)

      const { id } = await context.params
      const access = await checkInterfaceAccess(id, session.user.id)
      if (!access.hasAccess || !access.interfaceRow) {
        return createErrorResponse('Interface not found', 404)
      }

      return createSuccessResponse({ deployment: access.interfaceRow })
    } catch (error) {
      logger.error('Error fetching interface:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to fetch interface'), 500)
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session) return createErrorResponse('Unauthorized', 401)

      const parsed = await parseRequest(updateInterfaceContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const body = parsed.data.body
      const access = await checkInterfaceAccess(id, session.user.id)
      if (!access.hasAccess || !access.interfaceRow) {
        return createErrorResponse('Interface not found', 404)
      }

      const row = access.interfaceRow

      // All updates (metadata + spec) go through deploy orchestration so
      // reserved identifiers, conflicts, and output configs are revalidated.
      const result = await performInterfaceDeploy({
        workflowId: row.workflowId,
        userId: session.user.id,
        identifier: body.identifier || row.identifier,
        title: body.title || row.title,
        description: body.description ?? row.description ?? undefined,
        customizations: {
          primaryColor:
            body.customizations?.primaryColor ||
            (row.customizations as { primaryColor?: string } | null)?.primaryColor,
          brief:
            body.customizations?.brief || (row.customizations as { brief?: string } | null)?.brief,
        },
        authType: 'public',
        outputConfigs:
          body.outputConfigs ||
          ((row.outputConfigs as Array<{ blockId: string; path: string }>) ?? []),
        spec: body.spec !== undefined ? body.spec : row.spec,
        versionDescription: body.versionDescription,
        versionName: body.versionName,
        workspaceId: access.workspaceId,
      })
      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to update interface', 400)
      }
      return createSuccessResponse({
        id,
        interfaceUrl: result.interfaceUrl,
        message: 'Interface updated successfully',
      })
    } catch (error) {
      logger.error('Error updating interface:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to update interface'), 500)
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session) return createErrorResponse('Unauthorized', 401)

      const parsed = await parseRequest(deleteInterfaceContract, request, context)
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const access = await checkInterfaceAccess(id, session.user.id)
      if (!access.hasAccess) {
        return createErrorResponse('Interface not found', 404)
      }

      const result = await performInterfaceUndeploy({
        interfaceId: id,
        userId: session.user.id,
        workspaceId: access.workspaceId,
      })
      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to delete interface', 400)
      }

      return createSuccessResponse({ message: 'Interface deleted successfully' })
    } catch (error) {
      logger.error('Error deleting interface:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to delete interface'), 500)
    }
  }
)
