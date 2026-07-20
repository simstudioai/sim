import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type ManagedAgentMemoryStore,
  managedAgentProxyParamsSchema,
  managedAgentProxyQuerySchema,
} from '@/lib/api/contracts'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getDecryptedApiKey } from '@/lib/managed-agents/connections'
import {
  ManagedAgentProxyError,
  proxyManagedAgentsGet,
} from '@/lib/managed-agents/proxy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ManagedAgentMemoryStoresAPI')

interface AnthropicMemoryStore {
  id: string
  name?: string
  description?: string
  archived_at?: string | null
  type?: 'memory_store'
}

interface AnthropicMemoryStorePage {
  data?: AnthropicMemoryStore[]
  next_page?: string | null
}

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/managed-agent-connections/[id]/memory-stores — proxies to
 * Anthropic's `GET /v1/memory_stores` using the connection's stored API
 * key. Powers the Memory Store combobox on the Managed Agent block.
 *
 * Archived stores are excluded (Anthropic's `include_archived` defaults
 * to false, and we don't surface them to workflow authors — a stale
 * memory store would just fail at session-create time).
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const rawParams = await context.params
    const paramsValidation = managedAgentProxyParamsSchema.safeParse(rawParams)
    const queryValidation = managedAgentProxyQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!paramsValidation.success || !queryValidation.success) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }
    const { id } = paramsValidation.data
    const { workspaceId } = queryValidation.data

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const apiKey = await getDecryptedApiKey({ id, workspaceId })
    if (!apiKey) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    try {
      const body = await proxyManagedAgentsGet<AnthropicMemoryStorePage>(
        apiKey,
        '/v1/memory_stores?limit=100'
      )
      const data: ManagedAgentMemoryStore[] = (body.data ?? [])
        .filter((row) => row.archived_at == null)
        .map((row) => ({
          id: row.id,
          name: row.name ?? null,
          description: row.description ?? null,
          archivedAt: row.archived_at ?? null,
        }))
      return NextResponse.json({ data })
    } catch (error) {
      if (error instanceof ManagedAgentProxyError) {
        // 404 = feature not enabled on this workspace / beta not granted.
        // Return empty so the Memory Store field shows "no options" instead
        // of blocking the whole editor.
        if (error.status === 404) return NextResponse.json({ data: [] })
        return NextResponse.json({ error: error.message }, { status: 502 })
      }
      throw error
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to list memory stores`, error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to list memory stores') },
      { status: 500 }
    )
  }
})
