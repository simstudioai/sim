import { createLogger } from '@sim/logger'
import type { NextRequest, NextResponse } from 'next/server'
import { verifyInternalToken } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function addNoCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  return response
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployed state for workflow: ${id}`)

    const authHeader = request.headers.get('authorization')
    let isInternalCall = false

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const verification = await verifyInternalToken(token)
      isInternalCall = verification.valid
    }

    if (!isInternalCall) {
      const { error } = await validateWorkflowPermissions(id, requestId, 'read')
      if (error) {
        const response = createErrorResponse(error.message, error.status)
        return addNoCacheHeaders(response)
      }
    } else {
      logger.debug(`[${requestId}] Internal API call for deployed workflow: ${id}`)
    }

    let deployedState = null
    try {
      const data = await loadDeployedWorkflowState(id)
      deployedState = {
        blocks: data.blocks,
        edges: data.edges,
        loops: data.loops,
        parallels: data.parallels,
        variables: data.variables,
      }
    } catch {
      deployedState = null
    }

    const response = createSuccessResponse({ deployedState })
    return addNoCacheHeaders(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployed state: ${id}`, error)
    const response = createErrorResponse(error.message || 'Failed to fetch deployed state', 500)
    return addNoCacheHeaders(response)
  }
}
