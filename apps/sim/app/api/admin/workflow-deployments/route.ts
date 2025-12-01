import { db } from '@sim/db'
import { user, workflowDeploymentVersion } from '@sim/db/schema'
import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('AdminWorkflowDeploymentsAPI')

/**
 * GET /api/admin/workflow-deployments?workflowId=xxx
 * List all deployment versions for a workflow by ID
 * Superuser only
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Check authentication
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized deployments list attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is superuser
    const currentUser = await db
      .select({ isSuperUser: user.isSuperUser })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (!currentUser[0]?.isSuperUser) {
      logger.warn(`[${requestId}] Non-superuser attempted deployments list: ${session.user.id}`)
      return NextResponse.json({ error: 'Forbidden - Superuser access required' }, { status: 403 })
    }

    // Get workflow ID from query params
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId query parameter is required' }, { status: 400 })
    }

    // Fetch deployment versions
    const versions = await db
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        name: workflowDeploymentVersion.name,
        isActive: workflowDeploymentVersion.isActive,
        createdAt: workflowDeploymentVersion.createdAt,
        createdBy: workflowDeploymentVersion.createdBy,
        deployedBy: user.name,
      })
      .from(workflowDeploymentVersion)
      .leftJoin(user, eq(workflowDeploymentVersion.createdBy, user.id))
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
      .orderBy(desc(workflowDeploymentVersion.version))

    logger.info(`[${requestId}] Successfully retrieved ${versions.length} deployments for workflow ${workflowId}`, {
      superUserId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      versions,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error listing workflow deployments:`, error)
    return NextResponse.json(
      { error: 'Failed to list deployments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

