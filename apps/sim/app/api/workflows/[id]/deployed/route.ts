import { db, workflowDeploymentVersion } from '@sim/db'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { verifyInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
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

    const [active] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    const response = createSuccessResponse({
      deployedState: active?.state || null,
    })
    return addNoCacheHeaders(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployed state: ${id}`, error)
    const response = createErrorResponse(error.message || 'Failed to fetch deployed state', 500)
    return addNoCacheHeaders(response)
  }
}
