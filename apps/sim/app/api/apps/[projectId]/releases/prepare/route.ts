import type { NextRequest } from 'next/server'
import { prepareAppReleaseContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { prepareProjectRelease } from '@/lib/apps/prepare-release'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

/**
 * Prepare accepts only revisionId + buildId.
 * Actions, template/sdk versions, and artifact hash are derived server-side
 * from the revision + successful build (never from a second client action list).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(prepareAppReleaseContract, request, context, {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    })
    if (!parsed.success) return parsed.response

    const { projectId } = parsed.data.params
    const { revisionId, buildId } = parsed.data.body

    const result = await prepareProjectRelease({
      projectId,
      revisionId,
      buildId,
      userId: session.user.id,
    })
    if (!result.ok) return createErrorResponse(result.error, result.status, result.code)
    return createSuccessResponse({ releaseId: result.releaseId, state: 'prepared' })
  }
)
