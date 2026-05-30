import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES,
  MAX_MCP_SERVER_TOOLS_METADATA_BYTES,
  MAX_MCP_SERVERS_PER_WORKFLOW,
  MAX_MCP_TOOLS_PER_SERVER,
} from '@/lib/mcp/constants'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import {
  acquireWorkflowMcpServerLock,
  isWorkflowMcpServerLockTimeout,
  setWorkflowMcpTransactionLockTimeout,
} from '@/lib/mcp/server-locks'
import {
  addMcpToolMetadataUsage,
  addMcpToolMetadataUsageRow,
  createMcpToolMetadataUsageRow,
  getMcpServerToolMetadataUsageRows,
  getMcpToolDescriptionForStorage,
  getMcpToolMetadataSizes,
  getMcpToolMetadataUsageFromRows,
  type McpToolMetadataUsage,
  validateMcpServerToolMetadataBudget,
  validateMcpToolMetadataForStorage,
} from '@/lib/mcp/tool-limits'
import { generateParameterSchemaForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'

const logger = createLogger('WorkflowMcpOrchestration')

export type WorkflowMcpOrchestrationErrorCode =
  | 'not_found'
  | 'validation'
  | 'forbidden'
  | 'conflict'
  | 'internal'

class WorkflowMcpExpectedError extends Error {
  constructor(
    message: string,
    readonly errorCode: WorkflowMcpOrchestrationErrorCode
  ) {
    super(message)
    this.name = 'WorkflowMcpExpectedError'
  }
}

interface ActorMetadata {
  actorName?: string | null
  actorEmail?: string | null
}

export interface PerformCreateWorkflowMcpServerParams extends ActorMetadata {
  workspaceId: string
  userId: string
  name: string
  description?: string | null
  isPublic?: boolean
  workflowIds?: string[]
}

export interface PerformCreateWorkflowMcpServerResult {
  success: boolean
  error?: string
  errorCode?: WorkflowMcpOrchestrationErrorCode
  server?: typeof workflowMcpServer.$inferSelect
  addedTools?: Array<{ workflowId: string; toolName: string }>
}

export interface PerformUpdateWorkflowMcpServerParams extends ActorMetadata {
  serverId: string
  workspaceId: string
  userId: string
  name?: string
  description?: string | null
  isPublic?: boolean
}

export interface PerformUpdateWorkflowMcpServerResult {
  success: boolean
  error?: string
  errorCode?: WorkflowMcpOrchestrationErrorCode
  server?: typeof workflowMcpServer.$inferSelect
  updatedFields?: string[]
}

export interface PerformDeleteWorkflowMcpServerParams extends ActorMetadata {
  serverId: string
  workspaceId: string
  userId: string
}

export interface PerformDeleteWorkflowMcpServerResult {
  success: boolean
  error?: string
  errorCode?: WorkflowMcpOrchestrationErrorCode
  server?: typeof workflowMcpServer.$inferSelect
}

export interface PerformCreateWorkflowMcpToolParams extends ActorMetadata {
  serverId: string
  workspaceId: string
  userId: string
  workflowId: string
  toolName?: string
  toolDescription?: string | null
  parameterSchema?: Record<string, unknown>
}

export interface PerformCreateWorkflowMcpToolResult {
  success: boolean
  error?: string
  errorCode?: WorkflowMcpOrchestrationErrorCode
  tool?: typeof workflowMcpTool.$inferSelect
}

export interface PerformUpdateWorkflowMcpToolParams extends ActorMetadata {
  serverId: string
  toolId: string
  workspaceId: string
  userId: string
  toolName?: string
  toolDescription?: string | null
  parameterSchema?: Record<string, unknown>
}

export interface PerformUpdateWorkflowMcpToolResult {
  success: boolean
  error?: string
  errorCode?: WorkflowMcpOrchestrationErrorCode
  tool?: typeof workflowMcpTool.$inferSelect
}

export interface PerformDeleteWorkflowMcpToolParams extends ActorMetadata {
  serverId: string
  toolId: string
  workspaceId: string
  userId: string
}

export interface PerformDeleteWorkflowMcpToolResult {
  success: boolean
  error?: string
  errorCode?: WorkflowMcpOrchestrationErrorCode
  tool?: typeof workflowMcpTool.$inferSelect
}

interface PreparedWorkflowMcpTool {
  workflowId: string
  toolName: string
  toolDescription: string | null
  parameterSchema: unknown
}

interface WorkflowMcpToolWorkflowRecord {
  id: string
  name: string
  description: string | null
}

interface WorkflowMcpServerCreateWorkflowRecord extends WorkflowMcpToolWorkflowRecord {
  isDeployed: boolean
  workspaceId: string | null
  deployedAt: Date | null
  updatedAt: Date
}

async function validateServerToolMetadataBudget(
  serverId: string,
  proposedTools: Array<{
    toolName: string
    toolDescription: string | null
    parameterSchema: unknown
  }>,
  tx: DbOrTx,
  excludeToolId?: string
): Promise<string | null> {
  let usage = getMcpToolMetadataUsageFromRows(
    await getMcpServerToolMetadataUsageRows(tx, serverId, excludeToolId)
  )
  for (const tool of proposedTools) {
    usage = addMcpToolMetadataUsage(usage, tool)
  }
  return validateMcpServerToolMetadataBudget(usage)
}

function validateServerToolMetadataBudgetForUpdate(
  currentUsage: McpToolMetadataUsage,
  proposedUsage: McpToolMetadataUsage
): string | null {
  if (
    proposedUsage.schemaBytes > MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES &&
    proposedUsage.schemaBytes > currentUsage.schemaBytes
  ) {
    return `MCP server tool schemas exceed maximum size of ${MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES} bytes`
  }
  if (
    proposedUsage.metadataBytes > MAX_MCP_SERVER_TOOLS_METADATA_BYTES &&
    proposedUsage.metadataBytes > currentUsage.metadataBytes
  ) {
    return `MCP server tool metadata exceeds maximum size of ${MAX_MCP_SERVER_TOOLS_METADATA_BYTES} bytes`
  }
  return null
}

async function prepareWorkflowMcpTool(params: {
  workflowRecord: WorkflowMcpToolWorkflowRecord
  toolName?: string
  toolDescription?: string | null
  parameterSchema?: Record<string, unknown>
}): Promise<PreparedWorkflowMcpTool> {
  const { workflowRecord } = params
  const toolName = sanitizeToolName(params.toolName?.trim() || workflowRecord.name)
  const toolDescription =
    params.toolDescription !== undefined
      ? params.toolDescription?.trim() || `Execute ${workflowRecord.name} workflow`
      : getMcpToolDescriptionForStorage(workflowRecord.description, workflowRecord.name)
  const parameterSchema =
    params.parameterSchema && Object.keys(params.parameterSchema).length > 0
      ? params.parameterSchema
      : await generateParameterSchemaForWorkflow(workflowRecord.id)
  const metadataLimitError = validateMcpToolMetadataForStorage({
    toolName,
    toolDescription,
    parameterSchema,
  })
  if (metadataLimitError) {
    throw new WorkflowMcpExpectedError(metadataLimitError, 'validation')
  }

  return {
    workflowId: workflowRecord.id,
    toolName,
    toolDescription,
    parameterSchema,
  }
}

function sameNullableDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right
  return left.getTime() === right.getTime()
}

function validateWorkflowForMcpServerCreate(
  workflowRecord: WorkflowMcpServerCreateWorkflowRecord,
  workspaceId: string
): void {
  if (workflowRecord.workspaceId !== workspaceId) {
    throw new WorkflowMcpExpectedError(
      `Workflow is outside this workspace: ${workflowRecord.id}`,
      'forbidden'
    )
  }
  if (!workflowRecord.isDeployed) {
    throw new WorkflowMcpExpectedError(
      `Workflow must be deployed before adding as an MCP tool: ${workflowRecord.id}`,
      'validation'
    )
  }
}

function assertWorkflowMcpServerCreateSnapshotCurrent(
  preparedWorkflow: WorkflowMcpServerCreateWorkflowRecord,
  lockedWorkflow: WorkflowMcpServerCreateWorkflowRecord
): void {
  if (
    preparedWorkflow.name !== lockedWorkflow.name ||
    preparedWorkflow.description !== lockedWorkflow.description ||
    !sameNullableDate(preparedWorkflow.deployedAt, lockedWorkflow.deployedAt) ||
    preparedWorkflow.updatedAt.getTime() !== lockedWorkflow.updatedAt.getTime()
  ) {
    throw new WorkflowMcpExpectedError(
      `Workflow changed while creating MCP server, retry shortly: ${preparedWorkflow.id}`,
      'conflict'
    )
  }
}

async function validateWorkflowMcpServerMembershipBudget(
  tx: DbOrTx,
  workflowIds: string[]
): Promise<string | null> {
  if (workflowIds.length === 0) return null

  const rows = await tx
    .select({
      workflowId: workflowMcpTool.workflowId,
      serverCount: sql<number>`count(distinct ${workflowMcpTool.serverId})`,
    })
    .from(workflowMcpTool)
    .where(
      and(inArray(workflowMcpTool.workflowId, workflowIds), isNull(workflowMcpTool.archivedAt))
    )
    .groupBy(workflowMcpTool.workflowId)

  for (const row of rows) {
    if ((Number(row.serverCount) || 0) >= MAX_MCP_SERVERS_PER_WORKFLOW) {
      return `Workflow can be exposed on at most ${MAX_MCP_SERVERS_PER_WORKFLOW} MCP servers: ${row.workflowId}`
    }
  }

  return null
}

export async function performCreateWorkflowMcpServer(
  params: PerformCreateWorkflowMcpServerParams
): Promise<PerformCreateWorkflowMcpServerResult> {
  try {
    const name = params.name.trim()
    const workflowIds = params.workflowIds || []
    if (workflowIds.length > MAX_MCP_TOOLS_PER_SERVER) {
      return {
        success: false,
        error: `Workflow MCP servers can include at most ${MAX_MCP_TOOLS_PER_SERVER} tools`,
        errorCode: 'validation',
      }
    }
    if (new Set(workflowIds).size !== workflowIds.length) {
      return {
        success: false,
        error: 'Workflow MCP server workflowIds must be unique',
        errorCode: 'validation',
      }
    }

    const preparedTools: PreparedWorkflowMcpTool[] = []
    const preparedToolNames = new Set<string>()
    const preparedWorkflows = new Map<string, WorkflowMcpServerCreateWorkflowRecord>()
    let totalUsage = { schemaBytes: 0, metadataBytes: 0 }

    if (workflowIds.length > 0) {
      const workflowRecords = await db
        .select({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          isDeployed: workflow.isDeployed,
          workspaceId: workflow.workspaceId,
          deployedAt: workflow.deployedAt,
          updatedAt: workflow.updatedAt,
        })
        .from(workflow)
        .where(and(inArray(workflow.id, workflowIds), isNull(workflow.archivedAt)))

      const workflowsById = new Map(
        workflowRecords.map((workflowRecord) => [workflowRecord.id, workflowRecord])
      )

      for (const workflowId of workflowIds) {
        const workflowRecord = workflowsById.get(workflowId)
        if (!workflowRecord) {
          return {
            success: false,
            error: `Workflow not found or archived: ${workflowId}`,
            errorCode: 'validation',
          }
        }

        validateWorkflowForMcpServerCreate(workflowRecord, params.workspaceId)

        const hasStartBlock = await hasValidStartBlock(workflowRecord.id)
        if (!hasStartBlock) {
          return {
            success: false,
            error: `Workflow must have a valid start block before adding as an MCP tool: ${workflowRecord.id}`,
            errorCode: 'validation',
          }
        }

        const preparedTool = await prepareWorkflowMcpTool({ workflowRecord })
        const { toolName, toolDescription, parameterSchema } = preparedTool
        if (preparedToolNames.has(toolName)) {
          return {
            success: false,
            error: `Duplicate MCP tool name after sanitization: ${toolName}`,
            errorCode: 'validation',
          }
        }
        preparedToolNames.add(toolName)
        totalUsage = addMcpToolMetadataUsage(totalUsage, {
          toolName,
          toolDescription,
          parameterSchema,
        })
        const budgetError = validateMcpServerToolMetadataBudget(totalUsage)
        if (budgetError) {
          return { success: false, error: budgetError, errorCode: 'validation' }
        }

        preparedTools.push(preparedTool)
        preparedWorkflows.set(workflowRecord.id, workflowRecord)
      }
    }

    const { server, addedTools, serverId } = await db.transaction(async (tx) => {
      await setWorkflowMcpTransactionLockTimeout(tx)

      if (workflowIds.length > 0) {
        const lockedWorkflows = await tx
          .select({
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            isDeployed: workflow.isDeployed,
            workspaceId: workflow.workspaceId,
            deployedAt: workflow.deployedAt,
            updatedAt: workflow.updatedAt,
          })
          .from(workflow)
          .where(and(inArray(workflow.id, workflowIds), isNull(workflow.archivedAt)))
          .orderBy(asc(workflow.id))
          .for('update')

        const lockedWorkflowsById = new Map(
          lockedWorkflows.map((workflowRecord) => [workflowRecord.id, workflowRecord])
        )

        for (const workflowId of workflowIds) {
          const lockedWorkflow = lockedWorkflowsById.get(workflowId)
          if (!lockedWorkflow) {
            throw new WorkflowMcpExpectedError(
              `Workflow not found or archived: ${workflowId}`,
              'validation'
            )
          }

          validateWorkflowForMcpServerCreate(lockedWorkflow, params.workspaceId)
          const preparedWorkflow = preparedWorkflows.get(workflowId)
          if (!preparedWorkflow) {
            throw new WorkflowMcpExpectedError(
              `Workflow not found or archived: ${workflowId}`,
              'validation'
            )
          }
          assertWorkflowMcpServerCreateSnapshotCurrent(preparedWorkflow, lockedWorkflow)
        }
      }

      const membershipBudgetError = await validateWorkflowMcpServerMembershipBudget(tx, workflowIds)
      if (membershipBudgetError) {
        throw new WorkflowMcpExpectedError(membershipBudgetError, 'validation')
      }

      const newServerId = generateId()
      const [createdServer] = await tx
        .insert(workflowMcpServer)
        .values({
          id: newServerId,
          workspaceId: params.workspaceId,
          createdBy: params.userId,
          name,
          description: params.description?.trim() || null,
          isPublic: params.isPublic ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      const insertedTools: Array<{ workflowId: string; toolName: string }> = []
      for (const preparedTool of preparedTools) {
        await tx.insert(workflowMcpTool).values({
          id: generateId(),
          serverId: newServerId,
          workflowId: preparedTool.workflowId,
          toolName: preparedTool.toolName,
          toolDescription: preparedTool.toolDescription,
          parameterSchema: preparedTool.parameterSchema,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        insertedTools.push({ workflowId: preparedTool.workflowId, toolName: preparedTool.toolName })
      }

      return { server: createdServer, addedTools: insertedTools, serverId: newServerId }
    })

    if (addedTools.length > 0) {
      mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId: params.workspaceId })
    }

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_ADDED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: serverId,
      resourceName: name,
      description: `Published workflow MCP server "${name}" with ${addedTools.length} tool(s)`,
      metadata: {
        serverName: name,
        isPublic: params.isPublic ?? false,
        toolCount: addedTools.length,
        toolNames: addedTools.map((tool) => tool.toolName),
        workflowIds: addedTools.map((tool) => tool.workflowId),
      },
    })

    return { success: true, server, addedTools }
  } catch (error) {
    if (error instanceof WorkflowMcpExpectedError) {
      return { success: false, error: error.message, errorCode: error.errorCode }
    }
    if (isWorkflowMcpServerLockTimeout(error)) {
      return {
        success: false,
        error: 'Workflow MCP server is busy, retry shortly',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to create workflow MCP server', { error })
    return { success: false, error: 'Failed to create workflow MCP server', errorCode: 'internal' }
  }
}

export async function performUpdateWorkflowMcpServer(
  params: PerformUpdateWorkflowMcpServerParams
): Promise<PerformUpdateWorkflowMcpServerResult> {
  const updateData: Partial<typeof workflowMcpServer.$inferInsert> = { updatedAt: new Date() }

  if (params.name !== undefined) updateData.name = params.name.trim()
  if (params.description !== undefined) updateData.description = params.description?.trim() || null
  if (params.isPublic !== undefined) updateData.isPublic = params.isPublic

  const updatedFields = Object.keys(updateData).filter((key) => key !== 'updatedAt')

  try {
    const [server] = await db
      .update(workflowMcpServer)
      .set(updateData)
      .where(
        and(
          eq(workflowMcpServer.id, params.serverId),
          eq(workflowMcpServer.workspaceId, params.workspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
      .returning()

    if (!server) {
      return { success: false, error: 'Server not found', errorCode: 'not_found' }
    }

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_UPDATED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      resourceName: server.name,
      description: `Updated workflow MCP server "${server.name}"`,
      metadata: {
        serverName: server.name,
        isPublic: server.isPublic,
        updatedFields,
      },
    })

    return { success: true, server, updatedFields }
  } catch (error) {
    logger.error('Failed to update workflow MCP server', { error })
    return { success: false, error: 'Failed to update workflow MCP server', errorCode: 'internal' }
  }
}

export async function performDeleteWorkflowMcpServer(
  params: PerformDeleteWorkflowMcpServerParams
): Promise<PerformDeleteWorkflowMcpServerResult> {
  try {
    const server = await db.transaction(async (tx) => {
      await acquireWorkflowMcpServerLock(tx, params.serverId)

      const [deletedServer] = await tx
        .delete(workflowMcpServer)
        .where(
          and(
            eq(workflowMcpServer.id, params.serverId),
            eq(workflowMcpServer.workspaceId, params.workspaceId)
          )
        )
        .returning()

      return deletedServer
    })

    if (!server) {
      return { success: false, error: 'Server not found', errorCode: 'not_found' }
    }

    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: params.serverId,
      workspaceId: params.workspaceId,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_REMOVED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      resourceName: server.name,
      description: `Unpublished workflow MCP server "${server.name}"`,
      metadata: { serverName: server.name },
    })

    return { success: true, server }
  } catch (error) {
    if (isWorkflowMcpServerLockTimeout(error)) {
      return {
        success: false,
        error: 'Workflow MCP server is busy, retry shortly',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to delete workflow MCP server', { error })
    return { success: false, error: 'Failed to delete workflow MCP server', errorCode: 'internal' }
  }
}

export async function performCreateWorkflowMcpTool(
  params: PerformCreateWorkflowMcpToolParams
): Promise<PerformCreateWorkflowMcpToolResult> {
  try {
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(
          eq(workflowMcpServer.id, params.serverId),
          eq(workflowMcpServer.workspaceId, params.workspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
      .limit(1)

    if (!server) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    const [workflowRecord] = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        isDeployed: workflow.isDeployed,
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(and(eq(workflow.id, params.workflowId), isNull(workflow.archivedAt)))
      .limit(1)

    if (!workflowRecord) {
      return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
    }
    if (workflowRecord.workspaceId !== params.workspaceId) {
      return {
        success: false,
        error: 'Workflow does not belong to this workspace',
        errorCode: 'validation',
      }
    }
    if (!workflowRecord.isDeployed) {
      return {
        success: false,
        error: 'Workflow must be deployed before adding as a tool',
        errorCode: 'validation',
      }
    }

    const hasStartBlock = await hasValidStartBlock(params.workflowId)
    if (!hasStartBlock) {
      return {
        success: false,
        error: 'Workflow must have a Start block to be used as an MCP tool',
        errorCode: 'validation',
      }
    }

    const preparedTool = await prepareWorkflowMcpTool({
      workflowRecord,
      toolName: params.toolName,
      toolDescription: params.toolDescription,
      parameterSchema: params.parameterSchema,
    })
    const { toolName, toolDescription, parameterSchema } = preparedTool

    const toolId = generateId()
    const tool = await db.transaction(async (tx) => {
      await setWorkflowMcpTransactionLockTimeout(tx)

      const [lockedWorkflow] = await tx
        .select({
          id: workflow.id,
          isDeployed: workflow.isDeployed,
          workspaceId: workflow.workspaceId,
        })
        .from(workflow)
        .where(and(eq(workflow.id, params.workflowId), isNull(workflow.archivedAt)))
        .for('update')
        .limit(1)

      if (!lockedWorkflow) {
        throw new WorkflowMcpExpectedError('Workflow not found', 'not_found')
      }
      if (lockedWorkflow.workspaceId !== params.workspaceId) {
        throw new WorkflowMcpExpectedError(
          'Workflow does not belong to this workspace',
          'validation'
        )
      }
      if (!lockedWorkflow.isDeployed) {
        throw new WorkflowMcpExpectedError(
          'Workflow must be deployed before adding as a tool',
          'validation'
        )
      }

      await acquireWorkflowMcpServerLock(tx, params.serverId)

      const existingTools = await tx
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(
          and(eq(workflowMcpTool.serverId, params.serverId), isNull(workflowMcpTool.archivedAt))
        )
        .limit(MAX_MCP_TOOLS_PER_SERVER)

      if (existingTools.length >= MAX_MCP_TOOLS_PER_SERVER) {
        throw new WorkflowMcpExpectedError(
          `Workflow MCP servers can include at most ${MAX_MCP_TOOLS_PER_SERVER} tools`,
          'validation'
        )
      }

      const [existingTool] = await tx
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(
          and(
            eq(workflowMcpTool.serverId, params.serverId),
            eq(workflowMcpTool.workflowId, params.workflowId),
            isNull(workflowMcpTool.archivedAt)
          )
        )
        .limit(1)

      if (existingTool) {
        throw new WorkflowMcpExpectedError(
          'This workflow is already added as a tool to this server',
          'conflict'
        )
      }

      const [nameCollision] = await tx
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(
          and(
            eq(workflowMcpTool.serverId, params.serverId),
            eq(workflowMcpTool.toolName, toolName),
            isNull(workflowMcpTool.archivedAt)
          )
        )
        .limit(1)

      if (nameCollision) {
        throw new WorkflowMcpExpectedError(
          `MCP tool name already exists on this server: ${toolName}`,
          'conflict'
        )
      }

      const membershipBudgetError = await validateWorkflowMcpServerMembershipBudget(tx, [
        params.workflowId,
      ])
      if (membershipBudgetError) {
        throw new WorkflowMcpExpectedError(membershipBudgetError, 'validation')
      }

      const budgetError = await validateServerToolMetadataBudget(
        params.serverId,
        [{ toolName, toolDescription, parameterSchema }],
        tx
      )
      if (budgetError) {
        throw new WorkflowMcpExpectedError(budgetError, 'validation')
      }

      const [createdTool] = await tx
        .insert(workflowMcpTool)
        .values({
          id: toolId,
          serverId: params.serverId,
          workflowId: params.workflowId,
          toolName,
          toolDescription,
          parameterSchema,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      return createdTool
    })

    if (!tool) {
      return { success: false, error: 'Failed to add tool', errorCode: 'internal' }
    }

    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: params.serverId,
      workspaceId: params.workspaceId,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_UPDATED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      description: `Added tool "${toolName}" to MCP server`,
      metadata: {
        toolId,
        toolName,
        toolDescription,
        workflowId: params.workflowId,
        workflowName: workflowRecord.name,
      },
    })

    return { success: true, tool }
  } catch (error) {
    if (error instanceof WorkflowMcpExpectedError) {
      return { success: false, error: error.message, errorCode: error.errorCode }
    }
    if (isWorkflowMcpServerLockTimeout(error)) {
      return {
        success: false,
        error: 'Workflow MCP server is busy, retry shortly',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to create workflow MCP tool', { error })
    return { success: false, error: 'Failed to add tool', errorCode: 'internal' }
  }
}

export async function performUpdateWorkflowMcpTool(
  params: PerformUpdateWorkflowMcpToolParams
): Promise<PerformUpdateWorkflowMcpToolResult> {
  try {
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(
          eq(workflowMcpServer.id, params.serverId),
          eq(workflowMcpServer.workspaceId, params.workspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
      .limit(1)

    if (!server) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    const updateData: Partial<typeof workflowMcpTool.$inferInsert> = { updatedAt: new Date() }
    if (params.toolName !== undefined) updateData.toolName = sanitizeToolName(params.toolName)
    if (params.toolDescription !== undefined) {
      updateData.toolDescription = params.toolDescription?.trim() || null
    }
    if (params.parameterSchema !== undefined) updateData.parameterSchema = params.parameterSchema
    const updatedFields = Object.keys(updateData).filter((key) => key !== 'updatedAt')

    const tool = await db.transaction(async (tx) => {
      await acquireWorkflowMcpServerLock(tx, params.serverId)

      const [currentTool] = await tx
        .select({
          id: workflowMcpTool.id,
          toolName: workflowMcpTool.toolName,
          toolDescription: workflowMcpTool.toolDescription,
          parameterSchemaBytes: sql<number>`octet_length(${workflowMcpTool.parameterSchema}::text)`,
        })
        .from(workflowMcpTool)
        .where(
          and(
            eq(workflowMcpTool.id, params.toolId),
            eq(workflowMcpTool.serverId, params.serverId),
            isNull(workflowMcpTool.archivedAt)
          )
        )
        .limit(1)

      if (!currentTool) {
        throw new WorkflowMcpExpectedError('Tool not found', 'not_found')
      }

      const effectiveToolName = updateData.toolName ?? currentTool.toolName
      const effectiveToolDescription =
        updateData.toolDescription !== undefined
          ? updateData.toolDescription
          : currentTool.toolDescription
      const effectiveParameterSchema =
        updateData.parameterSchema !== undefined ? updateData.parameterSchema : undefined
      const metadataLimitError = validateMcpToolMetadataForStorage({
        toolName: effectiveToolName,
        toolDescription: effectiveToolDescription,
        ...(effectiveParameterSchema !== undefined && {
          parameterSchema: effectiveParameterSchema,
        }),
      })
      if (metadataLimitError) {
        throw new WorkflowMcpExpectedError(metadataLimitError, 'validation')
      }

      if (params.toolName !== undefined && effectiveToolName !== currentTool.toolName) {
        const [nameCollision] = await tx
          .select({ id: workflowMcpTool.id })
          .from(workflowMcpTool)
          .where(
            and(
              eq(workflowMcpTool.serverId, params.serverId),
              eq(workflowMcpTool.toolName, effectiveToolName),
              ne(workflowMcpTool.id, params.toolId),
              isNull(workflowMcpTool.archivedAt)
            )
          )
          .limit(1)

        if (nameCollision) {
          throw new WorkflowMcpExpectedError(
            `MCP tool name already exists on this server: ${effectiveToolName}`,
            'conflict'
          )
        }
      }

      const baseUsage = getMcpToolMetadataUsageFromRows(
        await getMcpServerToolMetadataUsageRows(tx, params.serverId, params.toolId)
      )
      const currentUsage = addMcpToolMetadataUsageRow(baseUsage, {
        id: currentTool.id,
        ...getMcpToolMetadataSizes({
          toolName: currentTool.toolName,
          toolDescription: currentTool.toolDescription,
        }),
        parameterSchemaBytes: Number(currentTool.parameterSchemaBytes) || 0,
      })
      const proposedUsage = addMcpToolMetadataUsageRow(
        baseUsage,
        effectiveParameterSchema !== undefined
          ? createMcpToolMetadataUsageRow({
              id: currentTool.id,
              toolName: effectiveToolName,
              toolDescription: effectiveToolDescription,
              parameterSchema: effectiveParameterSchema,
            })
          : {
              id: currentTool.id,
              ...getMcpToolMetadataSizes({
                toolName: effectiveToolName,
                toolDescription: effectiveToolDescription,
              }),
              parameterSchemaBytes: Number(currentTool.parameterSchemaBytes) || 0,
            }
      )
      const budgetError = validateServerToolMetadataBudgetForUpdate(currentUsage, proposedUsage)
      if (budgetError) {
        throw new WorkflowMcpExpectedError(budgetError, 'validation')
      }

      const [updatedTool] = await tx
        .update(workflowMcpTool)
        .set(updateData)
        .where(
          and(
            eq(workflowMcpTool.id, params.toolId),
            eq(workflowMcpTool.serverId, params.serverId),
            isNull(workflowMcpTool.archivedAt)
          )
        )
        .returning()

      return updatedTool
    })

    if (!tool) return { success: false, error: 'Tool not found', errorCode: 'not_found' }

    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: params.serverId,
      workspaceId: params.workspaceId,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_UPDATED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      description: `Updated tool "${tool.toolName}" in MCP server`,
      metadata: {
        toolId: params.toolId,
        toolName: tool.toolName,
        workflowId: tool.workflowId,
        updatedFields,
      },
    })

    return { success: true, tool }
  } catch (error) {
    if (error instanceof WorkflowMcpExpectedError) {
      return { success: false, error: error.message, errorCode: error.errorCode }
    }
    if (isWorkflowMcpServerLockTimeout(error)) {
      return {
        success: false,
        error: 'Workflow MCP server is busy, retry shortly',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to update workflow MCP tool', { error })
    return { success: false, error: 'Failed to update tool', errorCode: 'internal' }
  }
}

export async function performDeleteWorkflowMcpTool(
  params: PerformDeleteWorkflowMcpToolParams
): Promise<PerformDeleteWorkflowMcpToolResult> {
  try {
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(
          eq(workflowMcpServer.id, params.serverId),
          eq(workflowMcpServer.workspaceId, params.workspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
      .limit(1)

    if (!server) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    const tool = await db.transaction(async (tx) => {
      await acquireWorkflowMcpServerLock(tx, params.serverId)

      const [deletedTool] = await tx
        .delete(workflowMcpTool)
        .where(
          and(eq(workflowMcpTool.id, params.toolId), eq(workflowMcpTool.serverId, params.serverId))
        )
        .returning()

      return deletedTool
    })

    if (!tool) return { success: false, error: 'Tool not found', errorCode: 'not_found' }

    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: params.serverId,
      workspaceId: params.workspaceId,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_UPDATED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      description: `Removed tool "${tool.toolName}" from MCP server`,
      metadata: { toolId: params.toolId, toolName: tool.toolName, workflowId: tool.workflowId },
    })

    return { success: true, tool }
  } catch (error) {
    if (isWorkflowMcpServerLockTimeout(error)) {
      return {
        success: false,
        error: 'Workflow MCP server is busy, retry shortly',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to delete workflow MCP tool', { error })
    return { success: false, error: 'Failed to remove tool', errorCode: 'internal' }
  }
}
