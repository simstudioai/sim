import { desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { workflowDeploymentVersion } from '@/db/schema'

const logger = createLogger('WorkflowDeploymentsListAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const versions = await db
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        isActive: workflowDeploymentVersion.isActive,
        createdAt: workflowDeploymentVersion.createdAt,
        createdBy: workflowDeploymentVersion.createdBy,
      })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, id))
      .orderBy(desc(workflowDeploymentVersion.version))

    return createSuccessResponse({ versions })
  } catch (error: any) {
    logger.error(`[${requestId}] Error listing deployments for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to list deployments', 500)
  }
}
