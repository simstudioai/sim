import { db } from '@sim/db'
import { webhook, workflow, workflowSchedule } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { extractAndPersistCustomTools } from '@/lib/workflows/custom-tools-persistence'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'
import { getTrigger } from '@/triggers'
import {
  calculateNextRunTime,
  generateCronExpression,
  getScheduleTimeValues,
  validateCronExpression,
} from '@/lib/schedules/utils'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowStateAPI')

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const BlockDataSchema = z.object({
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  collection: z.unknown().optional(),
  count: z.number().optional(),
  loopType: z.enum(['for', 'forEach', 'while', 'doWhile']).optional(),
  whileCondition: z.string().optional(),
  doWhileCondition: z.string().optional(),
  parallelType: z.enum(['collection', 'count']).optional(),
  type: z.string().optional(),
})

const SubBlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.any(),
})

const BlockOutputSchema = z.any()

const BlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  position: PositionSchema,
  subBlocks: z.record(SubBlockStateSchema),
  outputs: z.record(BlockOutputSchema),
  enabled: z.boolean(),
  horizontalHandles: z.boolean().optional(),
  height: z.number().optional(),
  advancedMode: z.boolean().optional(),
  triggerMode: z.boolean().optional(),
  data: BlockDataSchema.optional(),
})

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  style: z.record(z.any()).optional(),
  data: z.record(z.any()).optional(),
  label: z.string().optional(),
  labelStyle: z.record(z.any()).optional(),
  labelShowBg: z.boolean().optional(),
  labelBgStyle: z.record(z.any()).optional(),
  labelBgPadding: z.array(z.number()).optional(),
  labelBgBorderRadius: z.number().optional(),
  markerStart: z.string().optional(),
  markerEnd: z.string().optional(),
})

const LoopSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  iterations: z.number(),
  loopType: z.enum(['for', 'forEach', 'while', 'doWhile']),
  forEachItems: z.union([z.array(z.any()), z.record(z.any()), z.string()]).optional(),
  whileCondition: z.string().optional(),
  doWhileCondition: z.string().optional(),
})

const ParallelSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  distribution: z.union([z.array(z.any()), z.record(z.any()), z.string()]).optional(),
  count: z.number().optional(),
  parallelType: z.enum(['count', 'collection']).optional(),
})

const WorkflowStateSchema = z.object({
  blocks: z.record(BlockStateSchema),
  edges: z.array(EdgeSchema),
  loops: z.record(LoopSchema).optional(),
  parallels: z.record(ParallelSchema).optional(),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.coerce.date().optional(),
  variables: z.any().optional(), // Workflow variables
})

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to normalized database tables
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized state update attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const body = await request.json()
    const state = WorkflowStateSchema.parse(body)

    // Fetch the workflow to check ownership/access
    const accessContext = await getWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for state update`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to update this workflow
    const canUpdate =
      accessContext?.isOwner ||
      (workflowData.workspaceId
        ? accessContext?.workspacePermission === 'write' ||
          accessContext?.workspacePermission === 'admin'
        : false)

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow state ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Sanitize custom tools in agent blocks before saving
    const { blocks: sanitizedBlocks, warnings } = sanitizeAgentToolsInBlocks(state.blocks as any)

    // Save to normalized tables
    // Ensure all required fields are present for WorkflowState type
    // Filter out blocks without type or name before saving
    const filteredBlocks = Object.entries(sanitizedBlocks).reduce(
      (acc, [blockId, block]: [string, any]) => {
        if (block.type && block.name) {
          // Ensure all required fields are present
          acc[blockId] = {
            ...block,
            enabled: block.enabled !== undefined ? block.enabled : true,
            horizontalHandles:
              block.horizontalHandles !== undefined ? block.horizontalHandles : true,
            height: block.height !== undefined ? block.height : 0,
            subBlocks: block.subBlocks || {},
            outputs: block.outputs || {},
          }
        }
        return acc
      },
      {} as typeof state.blocks
    )

    const typedBlocks = filteredBlocks as Record<string, BlockState>
    const canonicalLoops = generateLoopBlocks(typedBlocks)
    const canonicalParallels = generateParallelBlocks(typedBlocks)

    const workflowState = {
      blocks: filteredBlocks,
      edges: state.edges,
      loops: canonicalLoops,
      parallels: canonicalParallels,
      lastSaved: state.lastSaved || Date.now(),
      isDeployed: state.isDeployed || false,
      deployedAt: state.deployedAt,
    }

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState as any)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow ${workflowId} state:`, saveResult.error)
      return NextResponse.json(
        { error: 'Failed to save workflow state', details: saveResult.error },
        { status: 500 }
      )
    }

    await syncWorkflowWebhooks(workflowId, workflowState.blocks)
    await syncWorkflowSchedules(workflowId, workflowState.blocks)

    // Extract and persist custom tools to database
    try {
      const workspaceId = workflowData.workspaceId
      if (workspaceId) {
        const { saved, errors } = await extractAndPersistCustomTools(
          workflowState,
          workspaceId,
          userId
        )

        if (saved > 0) {
          logger.info(`[${requestId}] Persisted ${saved} custom tool(s) to database`, {
            workflowId,
          })
        }

        if (errors.length > 0) {
          logger.warn(`[${requestId}] Some custom tools failed to persist`, { errors, workflowId })
        }
      } else {
        logger.warn(
          `[${requestId}] Workflow has no workspaceId, skipping custom tools persistence`,
          {
            workflowId,
          }
        )
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist custom tools`, { error, workflowId })
    }

    // Update workflow's lastSynced timestamp and variables if provided
    const updateData: any = {
      lastSynced: new Date(),
      updatedAt: new Date(),
    }

    // If variables are provided in the state, update them in the workflow record
    if (state.variables !== undefined) {
      updateData.variables = state.variables
    }

    await db.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

    try {
      const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
      const notifyResponse = await fetch(`${socketUrl}/api/workflow-updated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId }),
      })

      if (!notifyResponse.ok) {
        logger.warn(
          `[${requestId}] Failed to notify Socket.IO server about workflow ${workflowId} update`
        )
      }
    } catch (notificationError) {
      logger.warn(
        `[${requestId}] Error notifying Socket.IO server about workflow ${workflowId} update`,
        notificationError
      )
    }

    return NextResponse.json({ success: true, warnings }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error saving workflow ${workflowId} state after ${elapsed}ms`,
      error
    )

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function getSubBlockValue<T = unknown>(block: BlockState, subBlockId: string): T | undefined {
  const value = block.subBlocks?.[subBlockId]?.value
  if (value === undefined || value === null) {
    return undefined
  }
  return value as T
}

async function syncWorkflowWebhooks(
  workflowId: string,
  blocks: Record<string, any>
): Promise<void> {
  await syncBlockResources(workflowId, blocks, {
    resourceName: 'webhook',
    subBlockId: 'webhookId',
    buildMetadata: buildWebhookMetadata,
    applyMetadata: upsertWebhookRecord,
  })
}

type ScheduleBlockInput = Parameters<typeof getScheduleTimeValues>[0]

async function syncWorkflowSchedules(
  workflowId: string,
  blocks: Record<string, any>
): Promise<void> {
  await syncBlockResources(workflowId, blocks, {
    resourceName: 'schedule',
    subBlockId: 'scheduleId',
    buildMetadata: buildScheduleMetadata,
    applyMetadata: upsertScheduleRecord,
  })
}

interface ScheduleMetadata {
  cronExpression: string | null
  nextRunAt: Date | null
  timezone: string
}

function buildScheduleMetadata(block: BlockState): ScheduleMetadata | null {
  const scheduleType = getSubBlockValue<string>(block, 'scheduleType') || 'daily'
  const scheduleBlock = convertToScheduleBlock(block)

  const scheduleValues = getScheduleTimeValues(scheduleBlock)
  const sanitizedValues =
    scheduleType !== 'custom' ? { ...scheduleValues, cronExpression: null } : scheduleValues

  try {
    const cronExpression = generateCronExpression(scheduleType, sanitizedValues)
    const timezone = scheduleValues.timezone || 'UTC'

    if (cronExpression) {
      const validation = validateCronExpression(cronExpression, timezone)
      if (!validation.isValid) {
        logger.warn('Invalid cron expression while syncing schedule', {
          blockId: block.id,
          cronExpression,
          error: validation.error,
        })
        return null
      }
    }

    const nextRunAt = calculateNextRunTime(scheduleType, sanitizedValues)

    return {
      cronExpression,
      timezone,
      nextRunAt,
    }
  } catch (error) {
    logger.error('Failed to build schedule metadata during sync', {
      blockId: block.id,
      error,
    })
    return null
  }
}

function convertToScheduleBlock(block: BlockState): ScheduleBlockInput {
  const subBlocks: ScheduleBlockInput['subBlocks'] = {}

  Object.entries(block.subBlocks || {}).forEach(([id, subBlock]) => {
    subBlocks[id] = { value: stringifySubBlockValue(subBlock?.value) }
  })

  return {
    type: block.type,
    subBlocks,
  }
}

interface WebhookMetadata {
  triggerPath: string
  provider: string | null
  providerConfig: Record<string, any>
}

function buildWebhookMetadata(block: BlockState): WebhookMetadata | null {
  const triggerId =
    getSubBlockValue<string>(block, 'triggerId') ||
    getSubBlockValue<string>(block, 'selectedTriggerId')
  const triggerConfig = getSubBlockValue<Record<string, any>>(block, 'triggerConfig') || {}
  const triggerCredentials = getSubBlockValue<string>(block, 'triggerCredentials')
  const triggerPath = getSubBlockValue<string>(block, 'triggerPath') || block.id

  const triggerDef = triggerId ? getTrigger(triggerId) : undefined
  const provider = triggerDef?.provider || null

  const providerConfig = {
    ...(typeof triggerConfig === 'object' ? triggerConfig : {}),
    ...(triggerCredentials ? { credentialId: triggerCredentials } : {}),
    ...(triggerId ? { triggerId } : {}),
  }

  return {
    triggerPath,
    provider,
    providerConfig,
  }
}

async function upsertWebhookRecord(
  workflowId: string,
  block: BlockState,
  webhookId: string,
  metadata: WebhookMetadata
): Promise<void> {
  const [existing] = await db.select().from(webhook).where(eq(webhook.id, webhookId)).limit(1)

  if (existing) {
    const needsUpdate =
      existing.blockId !== block.id ||
      existing.workflowId !== workflowId ||
      existing.path !== metadata.triggerPath

    if (needsUpdate) {
      await db
        .update(webhook)
        .set({
          workflowId,
          blockId: block.id,
          path: metadata.triggerPath,
          provider: metadata.provider || existing.provider,
          providerConfig: Object.keys(metadata.providerConfig).length
            ? metadata.providerConfig
            : existing.providerConfig,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, webhookId))
    }
    return
  }

  await db.insert(webhook).values({
    id: webhookId,
    workflowId,
    blockId: block.id,
    path: metadata.triggerPath,
    provider: metadata.provider,
    providerConfig: metadata.providerConfig,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  logger.info('Recreated missing webhook after workflow save', {
    workflowId,
    blockId: block.id,
    webhookId,
  })
}

async function upsertScheduleRecord(
  workflowId: string,
  block: BlockState,
  scheduleId: string,
  metadata: ScheduleMetadata
): Promise<void> {
  const now = new Date()
  const [existing] = await db
    .select({
      id: workflowSchedule.id,
      nextRunAt: workflowSchedule.nextRunAt,
    })
    .from(workflowSchedule)
    .where(eq(workflowSchedule.id, scheduleId))
    .limit(1)

  if (existing) {
    await db
      .update(workflowSchedule)
      .set({
        workflowId,
        blockId: block.id,
        cronExpression: metadata.cronExpression,
        nextRunAt: metadata.nextRunAt ?? existing.nextRunAt,
        timezone: metadata.timezone,
        updatedAt: now,
      })
      .where(eq(workflowSchedule.id, scheduleId))
    return
  }

  await db.insert(workflowSchedule).values({
    id: scheduleId,
    workflowId,
    blockId: block.id,
    cronExpression: metadata.cronExpression,
    nextRunAt: metadata.nextRunAt ?? null,
    triggerType: 'schedule',
    timezone: metadata.timezone,
    status: 'active',
    failedCount: 0,
    createdAt: now,
    updatedAt: now,
  })

  logger.info('Recreated missing schedule after workflow save', {
    workflowId,
    blockId: block.id,
    scheduleId,
  })
}

interface BlockResourceSyncConfig<T> {
  resourceName: string
  subBlockId: string
  buildMetadata: (block: BlockState, resourceId: string) => T | null
  applyMetadata: (
    workflowId: string,
    block: BlockState,
    resourceId: string,
    metadata: T
  ) => Promise<void>
}

async function syncBlockResources<T>(
  workflowId: string,
  blocks: Record<string, any>,
  config: BlockResourceSyncConfig<T>
): Promise<void> {
  const blockEntries = Object.values(blocks || {}).filter(Boolean) as BlockState[]
  if (blockEntries.length === 0) return

  for (const block of blockEntries) {
    const resourceId = getSubBlockValue<string>(block, config.subBlockId)
    if (!resourceId) continue

    const metadata = config.buildMetadata(block, resourceId)
    if (!metadata) {
      logger.warn(`Skipping ${config.resourceName} sync due to invalid configuration`, {
        workflowId,
        blockId: block.id,
        resourceId,
        resourceName: config.resourceName,
      })
      continue
    }

    try {
      await config.applyMetadata(workflowId, block, resourceId, metadata)
    } catch (error) {
      logger.error(`Failed to sync ${config.resourceName}`, {
        workflowId,
        blockId: block.id,
        resourceId,
        resourceName: config.resourceName,
        error,
      })
    }
  }
}

function stringifySubBlockValue(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
