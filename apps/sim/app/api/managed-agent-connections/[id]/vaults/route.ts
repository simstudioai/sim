import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type ManagedAgentVault,
  managedAgentProxyParamsSchema,
  managedAgentProxyQuerySchema,
} from '@/lib/api/contracts'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getDecryptedApiKey } from '@/lib/managed-agents/connections'
import {
  type AnthropicListPage,
  apiKeyFailureResponse,
  ManagedAgentProxyError,
  proxyManagedAgentsGet,
} from '@/lib/managed-agents/proxy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ManagedAgentVaultsAPI')

interface AnthropicVault {
  id: string
  name?: string
  description?: string
}

interface RouteContext {
  params: Promise<{ id: string }>
}

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

    const keyResult = await getDecryptedApiKey({ id, workspaceId })
    if (!keyResult.ok) return apiKeyFailureResponse(keyResult)
    const apiKey = keyResult.apiKey

    try {
      const body = await proxyManagedAgentsGet<AnthropicListPage<AnthropicVault>>(
        apiKey,
        '/v1/vaults?limit=100'
      )
      const data: ManagedAgentVault[] = (body.data ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? null,
        description: row.description ?? null,
      }))
      return NextResponse.json({ data })
    } catch (error) {
      if (error instanceof ManagedAgentProxyError) {
        // 404 on /v1/vaults could mean this beta doesn't expose vaults yet.
        // Return an empty list so the block's Vault dropdown just stays empty
        // instead of blocking the whole flow.
        if (error.status === 404) return NextResponse.json({ data: [] })
        return NextResponse.json({ error: error.message }, { status: 502 })
      }
      throw error
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to list vaults`, error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to list vaults') },
      { status: 500 }
    )
  }
})
