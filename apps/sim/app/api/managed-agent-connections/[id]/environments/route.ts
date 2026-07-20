import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type ManagedAgentEnvironment,
  managedAgentProxyParamsSchema,
  managedAgentProxyQuerySchema,
} from '@/lib/api/contracts'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getDecryptedApiKey } from '@/lib/managed-agents/connections'
import {
  type AnthropicListPage,
  ManagedAgentProxyError,
  proxyManagedAgentsGet,
} from '@/lib/managed-agents/proxy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ManagedAgentEnvironmentsAPI')

interface AnthropicEnvironment {
  id: string
  name?: string
  description?: string
  scope?: 'organization' | 'account' | null
  config?: { type?: 'cloud' | 'self_hosted' }
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

    const apiKey = await getDecryptedApiKey({ id, workspaceId })
    if (!apiKey) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    try {
      const body = await proxyManagedAgentsGet<AnthropicListPage<AnthropicEnvironment>>(
        apiKey,
        '/v1/environments?limit=100'
      )
      const data: ManagedAgentEnvironment[] = (body.data ?? [])
        .map((row) => {
          const envType = row.config?.type
          if (envType !== 'cloud' && envType !== 'self_hosted') return null
          return {
            id: row.id,
            name: row.name ?? null,
            description: row.description ?? null,
            envType,
            scope: row.scope ?? null,
          }
        })
        .filter((row): row is ManagedAgentEnvironment => row !== null)
      return NextResponse.json({ data })
    } catch (error) {
      if (error instanceof ManagedAgentProxyError) {
        return NextResponse.json({ error: error.message }, { status: 502 })
      }
      throw error
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to list environments`, error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to list environments') },
      { status: 500 }
    )
  }
})
