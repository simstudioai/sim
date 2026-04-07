import { db } from '@sim/db'
import { workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { generateId } from '@/lib/core/utils/uuid'
import { getActiveWorkflowRecord } from '@/lib/workflows/active-context'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowDetailsAPI')

export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflow-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { id } = await params

    logger.info(`[${requestId}] Fetching workflow details for ${id}`, { userId })

    const workflowData = await getActiveWorkflowRecord(id)
    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const permission = await getUserEntityPermissions(
      userId,
      'workspace',
      workflowData.workspaceId!
    )
    if (!permission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const blockRows = await db
      .select({
        id: workflowBlocks.id,
        type: workflowBlocks.type,
        subBlocks: workflowBlocks.subBlocks,
      })
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, id))

    const blocksRecord = Object.fromEntries(
      blockRows.map((block) => [block.id, { type: block.type, subBlocks: block.subBlocks }])
    )
    const inputs = extractInputFieldsFromBlocks(blocksRecord)

    const response = {
      id: workflowData.id,
      name: workflowData.name,
      description: workflowData.description,
      color: workflowData.color,
      folderId: workflowData.folderId,
      workspaceId: workflowData.workspaceId,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt?.toISOString() || null,
      runCount: workflowData.runCount,
      lastRunAt: workflowData.lastRunAt?.toISOString() || null,
      variables: workflowData.variables || {},
      inputs,
      createdAt: workflowData.createdAt.toISOString(),
      updatedAt: workflowData.updatedAt.toISOString(),
    }

    const limits = await getUserLimits(userId)

    const apiResponse = createApiResponse({ data: response }, limits, rateLimit)

    return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Workflow details fetch error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
