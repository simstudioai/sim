import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateInterfaceContract } from '@/lib/api/contracts/interfaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { generateInterfaceSpec } from '@/lib/interfaces/generate/generate-spec'
import {
  loadDeployedApiStartInput,
  loadDraftApiStartInput,
} from '@/lib/interfaces/orchestration/load-api-start'
import { checkWorkflowAccessForInterfaceCreation } from '@/app/api/interfaces/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('InterfaceGenerateAPI')

export const maxDuration = 60

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const parsed = await parseRequest(
      generateInterfaceContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      }
    )
    if (!parsed.success) return parsed.response

    const { workflowId, brief, primaryColor, title } = parsed.data.body
    const access = await checkWorkflowAccessForInterfaceCreation(workflowId, session.user.id)
    if (!access.hasAccess) {
      return createErrorResponse('Access denied', 403)
    }

    const draftStart = await loadDraftApiStartInput(workflowId)
    const start = draftStart.ok ? draftStart : await loadDeployedApiStartInput(workflowId)
    if (!start.ok) {
      return createErrorResponse(start.error, 400)
    }

    const [wf] = await db
      .select({ name: workflow.name, description: workflow.description })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    const result = await generateInterfaceSpec({
      workflowName: wf?.name || 'Workflow',
      workflowDescription: wf?.description,
      fields: start.data.fields,
      brief,
      primaryColor,
      title,
    })

    if (!result.success) {
      return createErrorResponse(result.error, 400)
    }

    return createSuccessResponse({ spec: result.spec })
  } catch (error) {
    logger.error('Error generating interface:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to generate interface'), 500)
  }
})
