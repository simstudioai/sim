import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { CursorKey } from '@/lib/api/list-query'
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
import {
  getLiveWorkflowMcpTool,
  getWorkflowMcpPublishableWorkflow,
  getWorkflowMcpServerById,
  getWorkflowMcpToolIncludingArchived,
  listLiveWorkflowMcpTools,
  listWorkflowMcpToolNames,
  listWorkspaceWorkflowMcpServers,
  type WorkflowMcpServerSortBy,
} from '@/lib/mcp/queries'
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
  const server = await getWorkflowMcpServerById(serverId)
  if (!server) throw new OrchestrationError('not_found', 'MCP server not found')
  const workspace = await resolveWorkspaceContext(server.workspaceId)
  return { ...workspace, server }
}

async function resolveWorkflowToolContext(serverId: string, workflowId: string) {
  const context = await resolveServerContext(serverId)
  const workflowRecord = await getWorkflowMcpPublishableWorkflow(context.workspaceId, workflowId)
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
  sortBy?: WorkflowMcpServerSortBy
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursorKeys?: CursorKey[]
}

/**
 * Workflow-MCP servers in a workspace, each with the tool names it publishes.
 *
 * Keyset-paged, because nothing caps how many servers a workspace publishes —
 * the same reasoning that made the external server list paged. An absent
 * `limit` still applies {@link MAX_LISTED_WORKFLOW_MCP_SERVERS}, so the copilot
 * adapter reads exactly the page it always read; it now learns the set was cut
 * from `nextCursorKeys` rather than from a row count it did the arithmetic on
 * itself.
 *
 * The tool-name aggregation stays a second bounded read rather than a join: a
 * join would multiply server rows by their tools and break the keyset page
 * boundary, and the names are decoration on the server summary, not the page's
 * unit.
 */
export const listWorkflowMcpDeployments = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.listWorkflowDeployments,
  resolveContext: ({ input }: { input: ListWorkflowMcpDeploymentsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const page = await listWorkspaceWorkflowMcpServers({
      workspaceId: context.workspaceId,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit ?? MAX_LISTED_WORKFLOW_MCP_SERVERS,
      cursorKeys: input.cursorKeys,
    })
    const servers = page.data
    const { namesByServerId, truncated } = await listWorkflowMcpToolNames(
      servers.map((server) => server.id),
      MAX_LISTED_WORKFLOW_MCP_TOOLS
    )
    return {
      servers: servers.map((server) => ({
        ...server,
        toolCount: namesByServerId.get(server.id)?.length ?? 0,
        toolNames: namesByServerId.get(server.id) ?? [],
      })),
      nextCursorKeys: page.nextCursorKeys,
      truncated: page.nextCursorKeys !== null || truncated,
    }
  },
})

export interface ReadWorkflowMcpDeploymentServerInput {
  serverId: string
}

/**
 * One published server.
 *
 * The list carries `toolCount`/`toolNames` as decoration on a page; this read
 * answers for a single server, so the inventory is left to
 * {@link listWorkflowMcpDeploymentTools} rather than duplicated here in a
 * second shape.
 */
export const readWorkflowMcpDeploymentServer = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.readWorkflowDeploymentServer,
  resolveContext: ({ input }: { input: ReadWorkflowMcpDeploymentServerInput }) =>
    resolveServerContext(input.serverId),
  authorizationOptions,
  async execute({ context }) {
    return { server: context.server }
  },
})

export interface ListWorkflowMcpDeploymentToolsInput {
  serverId: string
}

/**
 * Every tool a server publishes.
 *
 * Without this a caller could publish and unpublish tools but never enumerate
 * them: the server list reports tool *names* only, so nothing returned the
 * `workflowId` that addresses a tool for deletion.
 */
export const listWorkflowMcpDeploymentTools = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.listWorkflowDeploymentTools,
  resolveContext: ({ input }: { input: ListWorkflowMcpDeploymentToolsInput }) =>
    resolveServerContext(input.serverId),
  authorizationOptions,
  async execute({ context }) {
    const { tools, truncated } = await listLiveWorkflowMcpTools(
      context.server.id,
      MAX_LISTED_WORKFLOW_MCP_TOOLS
    )
    return { tools, truncated }
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
        'Workflow must be deployed before adding as an MCP tool. Deploy the workflow first.'
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
    const existing = await getLiveWorkflowMcpTool(context.server.id, context.workflow.id)
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
    const tool = await getWorkflowMcpToolIncludingArchived(context.server.id, context.workflow.id)
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
