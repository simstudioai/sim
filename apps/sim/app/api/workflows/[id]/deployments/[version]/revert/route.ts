import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performRevertToVersion } from '@/lib/workflows/orchestration'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('RevertToDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withRouteHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; version: string }> }
  ) => {
    const requestId = generateRequestId()
    const { id, version } = await params

    try {
      const {
        error,
        session,
        workflow: workflowRecord,
      } = await validateWorkflowPermissions(id, requestId, 'admin')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }

      const versionSelector = version === 'active' ? null : Number(version)
      if (version !== 'active' && !Number.isFinite(versionSelector)) {
        return createErrorResponse('Invalid version', 400)
      }

      const result = await performRevertToVersion({
        workflowId: id,
        version: version === 'active' ? 'active' : (versionSelector as number),
        userId: session!.user.id,
        workflow: (workflowRecord ?? {}) as Record<string, unknown>,
        request,
        actorName: session!.user.name ?? undefined,
        actorEmail: session!.user.email ?? undefined,
      })

      if (!result.success) {
        return createErrorResponse(
          result.error || 'Failed to revert',
          result.errorCode === 'not_found' ? 404 : 500
        )
      }

      return createSuccessResponse({
        message: 'Reverted to deployment version',
        lastSaved: result.lastSaved,
      })
    } catch (error: any) {
      logger.error('Error reverting to deployment version', error)
      return createErrorResponse(error.message || 'Failed to revert', 500)
    }
  }
)
