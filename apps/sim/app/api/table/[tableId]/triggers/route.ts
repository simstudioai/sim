import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableTriggersAPI')

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * GET /api/table/[tableId]/triggers
 * Returns deployed workflows with manual table triggers for this table.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table triggers access attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const rows = await db
      .select({
        webhookId: webhook.id,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowColor: workflow.color,
        providerConfig: webhook.providerConfig,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .leftJoin(
        workflowDeploymentVersion,
        and(
          eq(workflowDeploymentVersion.workflowId, workflow.id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .where(
        and(
          eq(webhook.provider, 'table'),
          eq(webhook.isActive, true),
          isNull(webhook.archivedAt),
          eq(workflow.isDeployed, true),
          isNull(workflow.archivedAt),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )

    interface ProviderConfig {
      tableId?: string
      tableSelector?: string
      manualTableId?: string
      eventType?: string
    }

    const manualTriggers = rows.filter((row) => {
      const config = row.providerConfig as ProviderConfig | null
      const configTableId = config?.tableId ?? config?.tableSelector ?? config?.manualTableId
      if (configTableId !== tableId) return false
      return config?.eventType === 'manual'
    })

    const workflows = manualTriggers.map((row) => ({
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      workflowColor: row.workflowColor,
    }))

    return NextResponse.json({ success: true, data: { workflows } })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching table triggers:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
