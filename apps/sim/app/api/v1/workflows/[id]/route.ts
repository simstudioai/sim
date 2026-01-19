import { db } from '@sim/db'
import { permissions, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidStartBlockType } from '@/lib/workflows/triggers/start-block-types'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowDetailsAPI')

export const revalidate = 0

interface InputField {
  name: string
  type: string
  description?: string
}

/**
 * Extracts input fields from workflow blocks.
 * Finds the starter/trigger block and extracts its inputFormat configuration.
 */
function extractInputFields(blocks: Array<{ type: string; subBlocks: unknown }>): InputField[] {
  const starterBlock = blocks.find((block) => isValidStartBlockType(block.type))

  if (!starterBlock) {
    return []
  }

  const subBlocks = starterBlock.subBlocks as Record<string, { value?: unknown }> | undefined
  const inputFormat = subBlocks?.inputFormat?.value

  if (!Array.isArray(inputFormat)) {
    return []
  }

  return inputFormat
    .filter(
      (field: unknown): field is { name: string; type?: string; description?: string } =>
        typeof field === 'object' &&
        field !== null &&
        'name' in field &&
        typeof (field as { name: unknown }).name === 'string' &&
        (field as { name: string }).name.trim() !== ''
    )
    .map((field) => ({
      name: field.name,
      type: field.type || 'string',
      ...(field.description && { description: field.description }),
    }))
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'logs-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { id } = await params

    logger.info(`[${requestId}] Fetching workflow details for ${id}`, { userId })

    const rows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        color: workflow.color,
        folderId: workflow.folderId,
        workspaceId: workflow.workspaceId,
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
        runCount: workflow.runCount,
        lastRunAt: workflow.lastRunAt,
        variables: workflow.variables,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      })
      .from(workflow)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workflow.id, id))
      .limit(1)

    const workflowData = rows[0]
    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const blocks = await db
      .select({
        type: workflowBlocks.type,
        subBlocks: workflowBlocks.subBlocks,
      })
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, id))

    const inputs = extractInputFields(blocks)

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
