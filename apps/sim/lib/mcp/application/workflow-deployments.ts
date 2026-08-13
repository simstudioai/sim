import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { db, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mcpServerDelegationPolicy } from '@/lib/mcp/application/authorization'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  performCreateWorkflowMcpServer,
  performCreateWorkflowMcpTool,
  performDeleteWorkflowMcpServer,
  performDeleteWorkflowMcpTool,
  performUpdateWorkflowMcpServer,
  performUpdateWorkflowMcpTool,
} from '@/lib/mcp/orchestration'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { getDeployedWorkflowInputFormat } from '@/lib/mcp/workflow-mcp-sync'
import {
  applyDescriptionOverrides,
  generateToolInputSchema,
  sanitizeToolName,
} from '@/lib/mcp/workflow-tool-schema'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const MAX_LISTED_WORKFLOW_MCP_SERVERS = 100
const MAX_LISTED_WORKFLOW_MCP_TOOLS = 2000
const MAX_MCP_PARAMETER_DESCRIPTION_OVERRIDES = 100
const authorizationOptions = { delegation: mcpServerDelegationPolicy }

async function resolveWorkspaceContext(workspaceId: string) {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveServerContext(serverId: string) {
  const [server] = await db
    .select()
    .from(workflowMcpServer)
    .where(and(eq(workflowMcpServer.id, serverId), isNull(workflowMcpServer.deletedAt)))
    .limit(1)
  if (!server) throw new OrchestrationError('not_found', 'MCP server not found')
  const workspace = await resolveWorkspaceContext(server.workspaceId)
  return { ...workspace, server }
}

async function resolveWorkflowToolContext(serverId: string, workflowId: string) {
  const context = await resolveServerContext(serverId)
  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(
      and(
        eq(workflow.id, workflowId),
        eq(workflow.workspaceId, context.workspaceId),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)
  if (!workflowRecord) throw new OrchestrationError('not_found', 'Workflow not found')
  return { ...context, workflow: workflowRecord }
}

function throwWorkflowMcpFailure(
  result: {
    error?: string
    errorCode?: 'not_found' | 'validation' | 'forbidden' | 'conflict' | 'internal'
  },
  fallback: string
): never {
  if (!result.errorCode || result.errorCode === 'internal') throw new Error(fallback)
  throw new OrchestrationError(result.errorCode, result.error ?? fallback)
}

function attribution(
  principal: Parameters<typeof resolvePrincipalAttribution>[0],
  billedAccountUserId: string
) {
  return resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: billedAccountUserId,
  }).attributedUserId
}

export interface ListWorkflowMcpDeploymentsInput {
  workspaceId: string
}

export const listWorkflowMcpDeployments = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.listWorkflowDeployments,
  resolveContext: ({ input }: { input: ListWorkflowMcpDeploymentsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ context }) {
    const rows = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
      })
      .from(workflowMcpServer)
      .where(
        and(
          eq(workflowMcpServer.workspaceId, context.workspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
      .orderBy(asc(workflowMcpServer.id))
      .limit(MAX_LISTED_WORKFLOW_MCP_SERVERS + 1)
    const truncated = rows.length > MAX_LISTED_WORKFLOW_MCP_SERVERS
    const servers = rows.slice(0, MAX_LISTED_WORKFLOW_MCP_SERVERS)
    const serverIds = servers.map((server) => server.id)
    const tools =
      serverIds.length === 0
        ? []
        : await db
            .select({ serverId: workflowMcpTool.serverId, toolName: workflowMcpTool.toolName })
            .from(workflowMcpTool)
            .where(
              and(inArray(workflowMcpTool.serverId, serverIds), isNull(workflowMcpTool.archivedAt))
            )
            .orderBy(asc(workflowMcpTool.serverId), asc(workflowMcpTool.toolName))
            .limit(MAX_LISTED_WORKFLOW_MCP_TOOLS + 1)
    const toolsTruncated = tools.length > MAX_LISTED_WORKFLOW_MCP_TOOLS
    const names = new Map<string, string[]>()
    for (const tool of tools.slice(0, MAX_LISTED_WORKFLOW_MCP_TOOLS)) {
      const existing = names.get(tool.serverId) ?? []
      existing.push(tool.toolName)
      names.set(tool.serverId, existing)
    }
    return {
      servers: servers.map((server) => ({
        ...server,
        toolCount: names.get(server.id)?.length ?? 0,
        toolNames: names.get(server.id) ?? [],
      })),
      truncated: truncated || toolsTruncated,
    }
  },
})

export interface CreateWorkflowMcpDeploymentServerInput {
  workspaceId: string
  name: string
  description?: string
  isPublic?: boolean
  workflowIds?: string[]
}

export const createWorkflowMcpDeploymentServer = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.createWorkflowDeploymentServer,
  resolveContext: ({ input }: { input: CreateWorkflowMcpDeploymentServerInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const result = await performCreateWorkflowMcpServer({
      ...input,
      workspaceId: context.workspaceId,
      userId: attribution(principal, context.billedAccountUserId),
      projectLegacyAudit: false,
      publishEffects: false,
    })
    if (!result.success || !result.server) {
      throwWorkflowMcpFailure(result, 'Failed to create workflow MCP server')
    }
    return { server: result.server, addedTools: result.addedTools ?? [] }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_ADDED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.server.id,
    resourceName: result.server.name,
    description: `Published workflow MCP server "${result.server.name}" with ${result.addedTools.length} tool(s)`,
    metadata: {
      serverName: result.server.name,
      isPublic: result.server.isPublic,
      toolCount: result.addedTools.length,
      toolNames: result.addedTools.map((tool) => tool.toolName),
      workflowIds: result.addedTools.map((tool) => tool.workflowId),
    },
  }),
  afterSuccess: ({ context, result }) =>
    result.addedTools.length > 0
      ? mcpPubSub?.publishWorkflowToolsChanged({
          serverId: result.server.id,
          workspaceId: context.workspaceId,
        })
      : undefined,
})

export interface UpdateWorkflowMcpDeploymentServerInput {
  serverId: string
  name?: string
  description?: string | null
  isPublic?: boolean
}

export const updateWorkflowMcpDeploymentServer = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.updateWorkflowDeploymentServer,
  resolveContext: ({ input }: { input: UpdateWorkflowMcpDeploymentServerInput }) =>
    resolveServerContext(input.serverId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const result = await performUpdateWorkflowMcpServer({
      ...input,
      workspaceId: context.workspaceId,
      userId: attribution(principal, context.billedAccountUserId),
      projectLegacyAudit: false,
      publishEffects: false,
    })
    if (!result.success || !result.server) {
      throwWorkflowMcpFailure(result, 'Failed to update workflow MCP server')
    }
    return { server: result.server, updatedFields: result.updatedFields ?? [] }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_UPDATED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.server.id,
    resourceName: result.server.name,
    description: `Updated workflow MCP server "${result.server.name}"`,
    metadata: {
      serverName: result.server.name,
      isPublic: result.server.isPublic,
      updatedFields: result.updatedFields,
    },
  }),
})

export interface DeleteWorkflowMcpDeploymentServerInput {
  serverId: string
}

export const deleteWorkflowMcpDeploymentServer = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.deleteWorkflowDeploymentServer,
  resolveContext: ({ input }: { input: DeleteWorkflowMcpDeploymentServerInput }) =>
    resolveServerContext(input.serverId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const result = await performDeleteWorkflowMcpServer({
      serverId: input.serverId,
      workspaceId: context.workspaceId,
      userId: attribution(principal, context.billedAccountUserId),
      projectLegacyAudit: false,
      publishEffects: false,
    })
    if (!result.success || !result.server) {
      throwWorkflowMcpFailure(result, 'Failed to delete workflow MCP server')
    }
    return { server: result.server }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_REMOVED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.server.id,
    resourceName: result.server.name,
    description: `Unpublished workflow MCP server "${result.server.name}"`,
    metadata: { serverName: result.server.name },
  }),
  afterSuccess: ({ context, result }) =>
    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: result.server.id,
      workspaceId: context.workspaceId,
    }),
})

export interface DeployWorkflowMcpToolInput {
  serverId: string
  workflowId: string
  toolName?: string
  toolDescription?: string
  parameterDescriptions?: Array<{ name?: string; description?: string }>
}

export const deployWorkflowMcpTool = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.deployWorkflowTool,
  resolveContext: ({ input }: { input: DeployWorkflowMcpToolInput }) =>
    resolveWorkflowToolContext(input.serverId, input.workflowId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    if (!context.workflow.isDeployed) {
      throw new OrchestrationError(
        'validation',
        'Workflow must be deployed before adding as an MCP tool. Use deploy_as_api first.'
      )
    }
    if (
      input.parameterDescriptions &&
      input.parameterDescriptions.length > MAX_MCP_PARAMETER_DESCRIPTION_OVERRIDES
    ) {
      throw new OrchestrationError(
        'validation',
        `MCP tools cannot override more than ${MAX_MCP_PARAMETER_DESCRIPTION_OVERRIDES} parameter descriptions`
      )
    }
    const [existing] = await db
      .select()
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, context.server.id),
          eq(workflowMcpTool.workflowId, context.workflow.id),
          isNull(workflowMcpTool.archivedAt)
        )
      )
      .limit(1)
    const toolName = sanitizeToolName(
      input.toolName || context.workflow.name || `workflow_${context.workflow.id}`
    )
    const toolDescription =
      input.toolDescription?.trim() || `Execute ${context.workflow.name} workflow`
    const parameterDescriptionOverrides = Object.fromEntries(
      (input.parameterDescriptions ?? [])
        .filter((entry) => typeof entry.name === 'string' && entry.name.trim().length > 0)
        .map((entry) => [entry.name?.trim() ?? '', entry.description?.trim() ?? ''])
        .filter(([, description]) => description.length > 0)
    )
    const parameterSchema = applyDescriptionOverrides(
      generateToolInputSchema(await getDeployedWorkflowInputFormat(context.workflow.id)),
      parameterDescriptionOverrides
    )
    const userId = attribution(principal, context.billedAccountUserId)
    const result = existing
      ? await performUpdateWorkflowMcpTool({
          serverId: context.server.id,
          toolId: existing.id,
          workspaceId: context.workspaceId,
          userId,
          toolName,
          toolDescription,
          parameterDescriptionOverrides,
          projectLegacyAudit: false,
          publishEffects: false,
        })
      : await performCreateWorkflowMcpTool({
          serverId: context.server.id,
          workspaceId: context.workspaceId,
          userId,
          workflowId: context.workflow.id,
          toolName,
          toolDescription,
          parameterDescriptionOverrides,
          projectLegacyAudit: false,
          publishEffects: false,
        })
    if (!result.success || !result.tool) {
      throwWorkflowMcpFailure(result, 'Failed to deploy workflow MCP tool')
    }
    return {
      tool: result.tool,
      server: context.server,
      workflow: context.workflow,
      updated: Boolean(existing),
      parameterSchema,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_UPDATED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.server.id,
    resourceName: result.server.name,
    description: `${result.updated ? 'Updated' : 'Added'} tool "${result.tool.toolName}" on MCP server`,
    metadata: {
      toolId: result.tool.id,
      toolName: result.tool.toolName,
      workflowId: result.workflow.id,
    },
  }),
  afterSuccess: ({ context, result }) =>
    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: result.server.id,
      workspaceId: context.workspaceId,
    }),
})

export interface UndeployWorkflowMcpToolInput {
  serverId: string
  workflowId: string
}

export const undeployWorkflowMcpTool = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.undeployWorkflowTool,
  resolveContext: ({ input }: { input: UndeployWorkflowMcpToolInput }) =>
    resolveWorkflowToolContext(input.serverId, input.workflowId),
  authorizationOptions,
  async execute({ principal, context }) {
    const [tool] = await db
      .select()
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, context.server.id),
          eq(workflowMcpTool.workflowId, context.workflow.id),
          isNull(workflowMcpTool.archivedAt)
        )
      )
      .limit(1)
    if (!tool) {
      throw new OrchestrationError('not_found', 'Workflow is not deployed to this MCP server')
    }
    const result = await performDeleteWorkflowMcpTool({
      serverId: context.server.id,
      toolId: tool.id,
      workspaceId: context.workspaceId,
      userId: attribution(principal, context.billedAccountUserId),
      projectLegacyAudit: false,
      publishEffects: false,
    })
    if (!result.success || !result.tool) {
      throwWorkflowMcpFailure(result, 'Failed to undeploy workflow MCP tool')
    }
    return { tool: result.tool, server: context.server, workflow: context.workflow }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_UPDATED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.server.id,
    resourceName: result.server.name,
    description: `Removed tool "${result.tool.toolName}" from MCP server`,
    metadata: {
      toolId: result.tool.id,
      toolName: result.tool.toolName,
      workflowId: result.workflow.id,
    },
  }),
  afterSuccess: ({ context, result }) =>
    mcpPubSub?.publishWorkflowToolsChanged({
      serverId: result.server.id,
      workspaceId: context.workspaceId,
    }),
})
