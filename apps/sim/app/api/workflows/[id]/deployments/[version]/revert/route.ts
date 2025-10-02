import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('RevertToDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionSelector = version === 'active' ? null : Number(version)
    if (version !== 'active' && !Number.isFinite(versionSelector)) {
      return createErrorResponse('Invalid version', 400)
    }

    let stateRow: { state: any } | null = null
    if (version === 'active') {
      const [row] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .limit(1)
      stateRow = row || null
    } else {
      const [row] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.version, versionSelector as number)
          )
        )
        .limit(1)
      stateRow = row || null
    }

    if (!stateRow?.state) {
      return createErrorResponse('Deployment version not found', 404)
    }

    const deployedState = stateRow.state
    if (!deployedState.blocks || !deployedState.edges) {
      return createErrorResponse('Invalid deployed state structure', 500)
    }

    const saveResult = await saveWorkflowToNormalizedTables(id, {
      blocks: deployedState.blocks,
      edges: deployedState.edges,
      loops: deployedState.loops || {},
      parallels: deployedState.parallels || {},
      lastSaved: Date.now(),
      isDeployed: true,
      deployedAt: new Date(),
      deploymentStatuses: deployedState.deploymentStatuses || {},
    })

    if (!saveResult.success) {
      return createErrorResponse(saveResult.error || 'Failed to save deployed state', 500)
    }

    await db
      .update(workflow)
      .set({ lastSynced: new Date(), updatedAt: new Date() })
      .where(eq(workflow.id, id))

    try {
      const socketServerUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
      await fetch(`${socketServerUrl}/api/workflow-reverted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: id, timestamp: Date.now() }),
      })
    } catch (e) {
      logger.error('Error sending workflow reverted event to socket server', e)
    }

    return createSuccessResponse({
      message: 'Reverted to deployment version',
      lastSaved: Date.now(),
    })
  } catch (error: any) {
    logger.error('Error reverting to deployment version', error)
    return createErrorResponse(error.message || 'Failed to revert', 500)
  }
}
