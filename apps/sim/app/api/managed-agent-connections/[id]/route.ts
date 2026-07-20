import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { rotateManagedAgentConnectionContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyAnthropicApiKey } from '@/lib/managed-agents/anthropic-verify'
import { rotateConnectionKey } from '@/lib/managed-agents/connections'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ManagedAgentConnectionAPI')

interface RouteContext {
  params: Promise<{ id: string }>
}

/** PATCH - Rotate a connection's API key. Verifies new key before writing. */
export const PATCH = withRouteHandler(async (req: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const parsed = await parseRequest(rotateManagedAgentConnectionContract, req, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, apiKey } = parsed.data.body

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    try {
      const rotated = await rotateConnectionKey({
        id,
        workspaceId,
        apiKey,
        verify: (key) => verifyAnthropicApiKey(key),
      })
      if (!rotated) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }
      logger.info(`[${requestId}] Rotated managed-agent connection ${id}`)
      return NextResponse.json({
        success: true,
        data: {
          ...rotated,
          lastVerifiedAt: rotated.lastVerifiedAt ? rotated.lastVerifiedAt.toISOString() : null,
          createdAt: rotated.createdAt.toISOString(),
          updatedAt: rotated.updatedAt.toISOString(),
        },
      })
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to rotate key')
      logger.warn(`[${requestId}] Rotate failed: ${message}`)
      return NextResponse.json({ error: message }, { status: 400 })
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to rotate connection key`, error)
    return NextResponse.json({ error: 'Failed to rotate connection key' }, { status: 500 })
  }
})
