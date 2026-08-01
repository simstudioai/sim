import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getFileShareContract, upsertFileShareContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performGetWorkspaceFileShare,
  performUpsertWorkspaceFileShare,
} from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileShareAPI')

/**
 * GET /api/workspaces/[id]/files/[fileId]/share
 * Fetch the public share state for a file (requires workspace membership).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getFileShareContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission === null) {
      logger.warn(`[${requestId}] User ${session.user.id} lacks access to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const result = await performGetWorkspaceFileShare({ workspaceId, fileId })
    if (!result.success) {
      return NextResponse.json(
        { error: messageForOrchestrationError(result, 'Failed to fetch share') },
        { status: statusForOrchestrationError(result.errorCode) }
      )
    }

    return NextResponse.json({ share: result.share ?? null })
  }
)

/**
 * PUT /api/workspaces/[id]/files/[fileId]/share
 * Enable or disable the public share for a file (requires write permission).
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(upsertFileShareContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params
    const { isActive, authType, password, allowedEmails, token } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(
        `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const result = await performUpsertWorkspaceFileShare({
      workspaceId,
      fileId,
      userId: session.user.id,
      isActive,
      authType,
      password,
      allowedEmails,
      token,
      actorName: session.user.name,
      actorEmail: session.user.email,
      request,
    })

    if (!result.success || !result.share) {
      return NextResponse.json(
        { error: messageForOrchestrationError(result, 'Failed to update share') },
        { status: statusForOrchestrationError(result.errorCode) }
      )
    }

    return NextResponse.json({ share: result.share })
  }
)
