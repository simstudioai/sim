import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getFormStatusContract } from '@/lib/api/contracts/forms'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormStatusAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return createErrorResponse('Unauthorized', 401)
      }

      const parsed = await parseRequest(getFormStatusContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workflowId } = parsed.data.params
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return createErrorResponse(
          authorization.message || 'Access denied',
          authorization.status || 403
        )
      }

      const formResult = await db
        .select({
          id: form.id,
          identifier: form.identifier,
          title: form.title,
          isActive: form.isActive,
        })
        .from(form)
        .where(and(eq(form.workflowId, workflowId), eq(form.isActive, true)))
        .limit(1)

      if (formResult.length === 0) {
        return createSuccessResponse({
          isDeployed: false,
          form: null,
        })
      }

      return createSuccessResponse({
        isDeployed: true,
        form: formResult[0],
      })
    } catch (error) {
      logger.error('Error fetching form status:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to fetch form status'), 500)
    }
  }
)
