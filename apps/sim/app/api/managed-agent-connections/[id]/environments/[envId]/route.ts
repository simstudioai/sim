import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type ManagedAgentEnvironment,
  managedAgentEnvironmentDetailParamsSchema,
  managedAgentProxyQuerySchema,
} from '@/lib/api/contracts'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getDecryptedApiKey } from '@/lib/managed-agents/connections'
import {
  apiKeyFailureResponse,
  ManagedAgentProxyError,
  proxyManagedAgentsGet,
} from '@/lib/managed-agents/proxy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ManagedAgentEnvironmentAPI')

interface AnthropicEnvironment {
  id: string
  name?: string
  description?: string
  scope?: 'organization' | 'account' | null
  config?: { type?: 'cloud' | 'self_hosted' }
}

interface RouteContext {
  params: Promise<{ id: string; envId: string }>
}

/**
 * GET /api/managed-agent-connections/[id]/environments/[envId] — used by
 * the workflow-block tool at run time to resolve `envType` before
 * building the session-create payload.
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
    const paramsValidation = managedAgentEnvironmentDetailParamsSchema.safeParse(rawParams)
    const queryValidation = managedAgentProxyQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!paramsValidation.success || !queryValidation.success) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }
    const { id, envId } = paramsValidation.data
    const { workspaceId } = queryValidation.data

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const keyResult = await getDecryptedApiKey({ id, workspaceId })
    if (!keyResult.ok) return apiKeyFailureResponse(keyResult)
    const apiKey = keyResult.apiKey

    try {
      const body = await proxyManagedAgentsGet<AnthropicEnvironment>(
        apiKey,
        `/v1/environments/${encodeURIComponent(envId)}`
      )
      const envType = body.config?.type
      if (envType !== 'cloud' && envType !== 'self_hosted') {
        return NextResponse.json(
          { error: 'Environment returned an unrecognised config.type' },
          { status: 502 }
        )
      }
      const data: ManagedAgentEnvironment = {
        id: body.id,
        name: body.name ?? null,
        description: body.description ?? null,
        envType,
        scope: body.scope ?? null,
      }
      return NextResponse.json({ data })
    } catch (error) {
      if (error instanceof ManagedAgentProxyError) {
        const status = error.status === 404 ? 404 : 502
        return NextResponse.json({ error: error.message }, { status })
      }
      throw error
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch environment`, error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to fetch environment') },
      { status: 500 }
    )
  }
})
