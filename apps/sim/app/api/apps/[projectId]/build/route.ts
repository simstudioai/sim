import type { NextRequest } from 'next/server'
import { buildAppRevisionContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { buildProjectRevision } from '@/lib/apps/build/project-build'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

/** Local Vite can run up to 5 minutes — keep the route alive in Next. */
export const maxDuration = 330

/**
 * Runs the app-build entrypoint for a revision (local Vite / fixture / future E2B).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(buildAppRevisionContract, request, context, {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    })
    if (!parsed.success) return parsed.response

    const { projectId } = parsed.data.params
    const { revisionId } = parsed.data.body

    const result = await buildProjectRevision({
      projectId,
      revisionId,
      userId: session.user.id,
    })
    if (!result.ok) {
      return createErrorResponse(result.error, result.status, result.code)
    }
    return createSuccessResponse({
      buildId: result.buildId,
      artifactManifestHash: result.artifactManifestHash,
      buildImageDigest: result.buildImageDigest,
      diagnostics: result.diagnostics,
      ...(result.reused ? { reused: true } : {}),
    })
  }
)
