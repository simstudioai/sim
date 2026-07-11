import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  renameWorkspaceFileContract,
  workspaceFileParamsSchema,
} from '@/lib/api/contracts/workspace-files'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import {
  performDeleteWorkspaceFileItems,
  performRenameWorkspaceFile,
  workspaceFilesOrchestrationStatus,
} from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileAPI')

/**
 * PATCH /api/workspaces/[id]/files/[fileId]
 * Rename a workspace file (requires write permission)
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(renameWorkspaceFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId, fileId } = parsed.data.params
      const { name, locked } = parsed.data.body

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

      const existingFile = await getWorkspaceFile(workspaceId, fileId)
      if (!existingFile) {
        return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })
      }

      if (locked !== undefined && locked !== existingFile.locked && userPermission !== 'admin') {
        return NextResponse.json(
          { success: false, error: 'Admin access required to lock files' },
          { status: 403 }
        )
      }

      const isLockOnlyUpdate = name === existingFile.name

      const result = await performRenameWorkspaceFile({
        workspaceId,
        fileId,
        name,
        userId: session.user.id,
        locked,
        isLockOnlyUpdate,
      })
      if (!result.success || !result.file) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: workspaceFilesOrchestrationStatus(result.errorCode) }
        )
      }

      logger.info(`[${requestId}] Renamed workspace file: ${fileId} to "${result.file.name}"`)

      captureServerEvent(
        session.user.id,
        'file_renamed',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      return NextResponse.json({
        success: true,
        file: result.file,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error renaming workspace file:`, error)
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(error, 'Failed to rename file'),
        },
        { status: 500 }
      )
    }
  }
)

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
          { status: workspaceFilesOrchestrationStatus(result.errorCode) }
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
