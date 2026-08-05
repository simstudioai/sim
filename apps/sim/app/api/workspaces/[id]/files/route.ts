import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createWorkspaceFileContract,
  listWorkspaceFilesQuerySchema,
  workspaceFilesParamsSchema,
} from '@/lib/api/contracts/workspace-files'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceShares } from '@/lib/public-shares/share-manager'
import { listWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  performCreateWorkspaceFile,
} from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFilesAPI')

/**
 * GET /api/workspaces/[id]/files
 * List all files for a workspace (requires read permission)
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const paramsResult = workspaceFilesParamsSchema.safeParse(await params)
    if (!paramsResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
        { status: 400 }
      )
    }
    const { id: workspaceId } = paramsResult.data

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Check workspace permissions (requires read)
      const userPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
      if (!userPermission) {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const queryResult = listWorkspaceFilesQuerySchema.safeParse(
        Object.fromEntries(request.nextUrl.searchParams.entries())
      )
      if (!queryResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(queryResult.error, 'Invalid scope') },
          { status: 400 }
        )
      }
      const { scope } = queryResult.data

      const files = await listWorkspaceFiles(workspaceId, { scope })

      const shares = await getWorkspaceShares('file', workspaceId)
      const filesWithShares = files.map((file) => ({
        ...file,
        share: shares.get(file.id) ?? null,
      }))

      logger.info(`[${requestId}] Listed ${files.length} files for workspace ${workspaceId}`)

      return NextResponse.json({
        success: true,
        files: filesWithShares,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error listing workspace files:`, error)
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(error, 'Failed to list files'),
        },
        { status: 500 }
      )
    }
  }
)

/**
 * POST /api/workspaces/[id]/files
 * Create an authored workspace file (requires write permission)
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const paramsResult = workspaceFilesParamsSchema.safeParse(await context.params)
      if (!paramsResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
          { status: 400 }
        )
      }
      const { id: workspaceId } = paramsResult.data

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

      const parsed = await parseRequest(createWorkspaceFileContract, request, context, {
        maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
      })
      if (!parsed.success) return parsed.response
      const { name, contentType, folderId, content, encoding } = parsed.data.body

      const result = await performCreateWorkspaceFile({
        workspaceId,
        userId: session.user.id,
        name,
        contentType: contentType ?? getMimeTypeFromExtension(getFileExtension(name)),
        folderId,
        content: Buffer.from(content, encoding),
        exactName: false,
        actorName: session.user.name,
        actorEmail: session.user.email,
        request,
      })
      if (!result.success || !result.file) {
        return NextResponse.json(
          {
            success: false,
            error: messageForOrchestrationError(result, 'Failed to create file'),
          },
          { status: statusForOrchestrationError(result.errorCode) }
        )
      }

      logger.info(`[${requestId}] Created workspace file: ${result.file.name}`)
      return NextResponse.json({ success: true, file: result.file }, { status: 201 })
    } catch (error) {
      logger.error(`[${requestId}] Error creating workspace file:`, error)

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create file',
        },
        { status: 500 }
      )
    }
  }
)
