import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workspaceFileParamsSchema } from '@/lib/api/contracts/workspace-files'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performRestoreWorkspaceFile } from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreWorkspaceFileAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()
    const paramsResult = workspaceFileParamsSchema.safeParse(await params)
    if (!paramsResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
        { status: 400 }
      )
    }
    const { id: workspaceId, fileId } = paramsResult.data

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (userPermission !== 'admin' && userPermission !== 'write') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const result = await performRestoreWorkspaceFile({
        workspaceId,
        fileId,
        userId: session.user.id,
      })
      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: result.errorCode === 'conflict' ? 409 : 500 }
        )
      }

      logger.info(`[${requestId}] Restored workspace file ${fileId}`)

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Error restoring workspace file ${fileId}`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Internal server error') },
        { status: 500 }
      )
    }
  }
)
