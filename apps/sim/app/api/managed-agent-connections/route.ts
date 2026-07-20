import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createManagedAgentConnectionContract,
  deleteManagedAgentConnectionQuerySchema,
  listManagedAgentConnectionsQuerySchema,
} from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyAnthropicApiKey } from '@/lib/managed-agents/anthropic-verify'
import {
  createConnection,
  deleteConnection,
  listConnections,
} from '@/lib/managed-agents/connections'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ManagedAgentConnectionsAPI')

function serialize<
  T extends {
    lastVerifiedAt: Date | null
    createdAt: Date
    updatedAt: Date
  },
>(row: T) {
  return {
    ...row,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** GET - List Managed Agent connections in a workspace */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const query = listManagedAgentConnectionsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!query.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: query.error.issues },
        { status: 400 }
      )
    }
    const { workspaceId } = query.data

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const rows = await listConnections({ workspaceId })
    return NextResponse.json({ data: rows.map(serialize) }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list connections`, error)
    return NextResponse.json(
      { error: 'Failed to list managed-agent connections' },
      { status: 500 }
    )
  }
})

/**
 * POST - Register a new Managed Agent connection.
 *
 * Body: `{workspaceId, name, apiKey}`. The key is verified against
 * `GET /v1/agents` before we persist the row; a failed verify never
 * writes.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const parsed = await parseRequest(createManagedAgentConnectionContract, req, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, name, apiKey } = parsed.data.body

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    try {
      const created = await createConnection({
        workspaceId,
        userId,
        name,
        apiKey,
        verify: (key) => verifyAnthropicApiKey(key),
      })
      logger.info(`[${requestId}] Created managed-agent connection ${created.id}`)
      return NextResponse.json({ success: true, data: serialize(created) })
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to create connection')
      logger.warn(`[${requestId}] Create failed: ${message}`)
      return NextResponse.json({ error: message }, { status: 400 })
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to create connection`, error)
    return NextResponse.json(
      { error: 'Failed to create managed-agent connection' },
      { status: 500 }
    )
  }
})

/** DELETE - Remove a Managed Agent connection */
export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const query = deleteManagedAgentConnectionQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!query.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: query.error.issues },
        { status: 400 }
      )
    }
    const { id, workspaceId } = query.data

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const deleted = await deleteConnection({ id, workspaceId })
    if (!deleted) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }
    logger.info(`[${requestId}] Deleted managed-agent connection ${id}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Failed to delete connection`, error)
    return NextResponse.json(
      { error: 'Failed to delete managed-agent connection' },
      { status: 500 }
    )
  }
})
