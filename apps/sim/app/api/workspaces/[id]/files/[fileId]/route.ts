import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  renameWorkspaceFileContract,
  workspaceFileParamsSchema,
} from '@/lib/api/contracts/workspace-files'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileAPI')

/**
 * PATCH /api/workspaces/[id]/files/[fileId]
 * Rename a workspace file (requires write permission)
 */
export const PATCH = defineInternalJsonRoute({
  contract: renameWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.rename,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal rename behavior' }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    name: body.name,
  }),
  useCase: renameWorkspaceFile,
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'file_renamed',
      { workspace_id: result.file.workspaceId },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  present: ({ file }) => ({ success: true, file: { ...file, folderId: file.folderId ?? null } }),
})

/**
 * DELETE /api/workspaces/[id]/files/[fileId]
 * Archive a workspace file (requires write permission)
 */
export const DELETE = withRouteHandler(
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

      // Check workspace permissions (requires write)
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (userPermission !== 'admin' && userPermission !== 'write') {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const result = await performDeleteWorkspaceFileItems({
        workspaceId,
        userId: session.user.id,
        fileIds: [fileId],
      })
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          {
            status:
              result.errorCode === 'validation'
                ? 400
                : result.errorCode === 'not_found'
                  ? 404
                  : 500,
          }
        )
      }

      logger.info(`[${requestId}] Archived workspace file: ${fileId}`)

      captureServerEvent(
        session.user.id,
        'file_deleted',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      return NextResponse.json({
        success: true,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting workspace file:`, error)
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(error, 'Failed to delete file'),
        },
        { status: 500 }
      )
    }
  }
)
