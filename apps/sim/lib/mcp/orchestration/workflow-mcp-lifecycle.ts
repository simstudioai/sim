import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { generateParameterSchemaForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'

const logger = createLogger('WorkflowMcpOrchestration')

export type WorkflowMcpOrchestrationErrorCode = 'not_found' | 'validation' | 'internal'

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
  errorCode?: WorkflowMcpOrchestrationErrorCode | 'conflict'
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

export async function performCreateWorkflowMcpServer(
  params: PerformCreateWorkflowMcpServerParams
): Promise<PerformCreateWorkflowMcpServerResult> {
  try {
    const name = params.name.trim()
    const serverId = generateId()
    const [server] = await db
      .insert(workflowMcpServer)
      .values({
        id: serverId,
        workspaceId: params.workspaceId,
        createdBy: params.userId,
        name,
        description: params.description?.trim() || null,
        isPublic: params.isPublic ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    const addedTools: Array<{ workflowId: string; toolName: string }> = []
    const workflowIds = params.workflowIds || []

    if (workflowIds.length > 0) {
      const workflows = await db
        .select({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          isDeployed: workflow.isDeployed,
          workspaceId: workflow.workspaceId,
        })
        .from(workflow)
        .where(and(inArray(workflow.id, workflowIds), isNull(workflow.archivedAt)))

      for (const workflowRecord of workflows) {
        if (workflowRecord.workspaceId !== params.workspaceId) {
          logger.warn('Skipping workflow MCP tool outside workspace', {
            workflowId: workflowRecord.id,
            workspaceId: params.workspaceId,
          })
          continue
        }
        if (!workflowRecord.isDeployed) {
          logger.warn('Skipping undeployed workflow MCP tool', { workflowId: workflowRecord.id })
          continue
        }
        const hasStartBlock = await hasValidStartBlock(workflowRecord.id)
        if (!hasStartBlock) {
          logger.warn('Skipping workflow MCP tool without start block', {
            workflowId: workflowRecord.id,
          })
          continue
        }

        const toolName = sanitizeToolName(workflowRecord.name)
        const parameterSchema = await generateParameterSchemaForWorkflow(workflowRecord.id)
        await db.insert(workflowMcpTool).values({
          id: generateId(),
          serverId,
          workflowId: workflowRecord.id,
          toolName,
          toolDescription: workflowRecord.description || `Execute ${workflowRecord.name} workflow`,
          parameterSchema,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        addedTools.push({ workflowId: workflowRecord.id, toolName })
      }

      if (addedTools.length > 0) {
        mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId: params.workspaceId })
      }
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
    const [existingServer] = await db
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

    if (!existingServer) {
      return { success: false, error: 'Server not found', errorCode: 'not_found' }
    }

    const [server] = await db
      .update(workflowMcpServer)
      .set(updateData)
      .where(and(eq(workflowMcpServer.id, params.serverId), isNull(workflowMcpServer.deletedAt)))
      .returning()

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
    const [server] = await db
      .delete(workflowMcpServer)
      .where(
        and(
          eq(workflowMcpServer.id, params.serverId),
          eq(workflowMcpServer.workspaceId, params.workspaceId)
        )
      )
      .returning()

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

    const [existingTool] = await db
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
      return {
        success: false,
        error: 'This workflow is already added as a tool to this server',
        errorCode: 'conflict',
      }
    }

    const toolName = sanitizeToolName(params.toolName?.trim() || workflowRecord.name)
    const toolDescription =
      params.toolDescription?.trim() ||
      workflowRecord.description ||
      `Execute ${workflowRecord.name} workflow`
    const parameterSchema =
      params.parameterSchema && Object.keys(params.parameterSchema).length > 0
        ? params.parameterSchema
        : await generateParameterSchemaForWorkflow(params.workflowId)

    const toolId = generateId()
    const [tool] = await db
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

    const [existingTool] = await db
      .select({ id: workflowMcpTool.id })
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.id, params.toolId),
          eq(workflowMcpTool.serverId, params.serverId),
          isNull(workflowMcpTool.archivedAt)
        )
      )
      .limit(1)

    if (!existingTool) return { success: false, error: 'Tool not found', errorCode: 'not_found' }

    const updateData: Partial<typeof workflowMcpTool.$inferInsert> = { updatedAt: new Date() }
    if (params.toolName !== undefined) updateData.toolName = sanitizeToolName(params.toolName)
    if (params.toolDescription !== undefined) {
      updateData.toolDescription = params.toolDescription?.trim() || null
    }
    if (params.parameterSchema !== undefined) updateData.parameterSchema = params.parameterSchema

    const updatedFields = Object.keys(updateData).filter((key) => key !== 'updatedAt')

    const [tool] = await db
      .update(workflowMcpTool)
      .set(updateData)
      .where(eq(workflowMcpTool.id, params.toolId))
      .returning()

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

    const [tool] = await db
      .delete(workflowMcpTool)
      .where(
        and(eq(workflowMcpTool.id, params.toolId), eq(workflowMcpTool.serverId, params.serverId))
      )
      .returning()

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
    logger.error('Failed to delete workflow MCP tool', { error })
    return { success: false, error: 'Failed to remove tool', errorCode: 'internal' }
  }
}
