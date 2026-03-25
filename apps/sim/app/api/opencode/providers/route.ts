import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getOpenCodeRouteError } from '@/lib/opencode/errors'
import { listOpenCodeProviders } from '@/lib/opencode/service'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('OpenCodeProvidersAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized OpenCode providers access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const access = await checkWorkspaceAccess(workspaceId, authResult.userId)
    if (!access.exists) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (!access.hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const repository = request.nextUrl.searchParams.get('repository') || undefined
    const providers = await listOpenCodeProviders(repository)
    return NextResponse.json({ data: providers })
  } catch (error) {
    const routeError = getOpenCodeRouteError(error, 'providers')
    logger.error(`[${requestId}] Failed to fetch OpenCode providers`, {
      error,
      status: routeError.status,
      responseMessage: routeError.message,
    })
    return NextResponse.json({ error: routeError.message }, { status: routeError.status })
  }
}
