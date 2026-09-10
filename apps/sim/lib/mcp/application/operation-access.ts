import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflowDeploymentVersion } from '@sim/db/schema'
import { isPlainRecord } from '@sim/utils/object'
import { loadWorkflowFromNormalizedTablesRaw } from '@sim/workflow-persistence'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isMcpRuntimeReference,
  normalizeMcpOperationPolicy,
  normalizeSavedMcpOperationName,
  permitsMcpOperation,
} from '@/lib/mcp/operation-policy'
import { resolveMcpToolBinding } from '@/lib/mcp/tool-binding'

function matchesTarget(value: unknown, targetId: string, serverId: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    (isMcpRuntimeReference(value) || value === targetId || value === serverId)
  )
}

export interface McpOperationAccess {
  allows(name: string): boolean
  argumentsMode: 'generated' | 'json'
}

/** Loads trusted saved restrictions after the surrounding use case has authorized the principal. */
export async function loadMcpOperationAccess(
  principal: Principal,
  target: {
    workspaceId: string
    serverId: string
    connectionId?: string
    assertedServerId?: string
  },
  purpose: 'discover' | 'execute' = 'discover'
): Promise<McpOperationAccess> {
  if (target.assertedServerId !== undefined && target.assertedServerId !== target.serverId) {
    throw new OrchestrationError(
      'forbidden',
      'MCP connection does not belong to the selected server'
    )
  }
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
    return {
      allows: () => true,
      argumentsMode: 'json',
    }
  }
  const blockId = principal.resourceScope?.mcpBlockId
  if (!blockId)
    throw new OrchestrationError(
      'forbidden',
      'MCP execution requires saved block policy provenance'
    )
  if (!principal.delegationContext)
    throw new OrchestrationError('forbidden', 'MCP workflow authority is required')
  const authority = principal.delegationContext.currentWorkflow
  const workflowId = authority?.workflowId ?? principal.delegationContext.workflowId
  let blocks: unknown
  if (authority?.mode === 'deployment') {
    const [version] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.id, authority.deploymentVersionId),
          eq(workflowDeploymentVersion.workflowId, workflowId)
        )
      )
      .limit(1)
    blocks = isPlainRecord(version?.state) ? version.state.blocks : undefined
  } else {
    const workflow = await loadWorkflowFromNormalizedTablesRaw(workflowId)
    if (workflow?.workspaceId !== target.workspaceId) {
      throw new OrchestrationError('forbidden', 'MCP policy workflow scope does not match')
    }
    blocks = workflow.blocks
  }
  const block = isPlainRecord(blocks) ? blocks[blockId] : undefined
  if (!isPlainRecord(block) || block.enabled === false || !isPlainRecord(block.subBlocks)) {
    throw new OrchestrationError('forbidden', 'MCP source block is missing or disabled')
  }
  const subBlocks = block.subBlocks
  const value = (id: string): unknown =>
    isPlainRecord(subBlocks[id]) ? subBlocks[id].value : undefined
  const targetId = target.connectionId ?? target.serverId
  const candidates: Array<{
    policy: ReturnType<typeof normalizeMcpOperationPolicy>
    toolName?: string
    dynamicTarget: boolean
  }> = []
  if (block.type === 'mcp') {
    const server = value('server')
    const connection = value('connection')
    if (
      !matchesTarget(server, targetId, target.serverId) ||
      (connection && !matchesTarget(connection, targetId, targetId))
    ) {
      throw new OrchestrationError('forbidden', 'MCP target does not match the saved block')
    }
    const action = value('operation') ?? 'run'
    if (action !== 'run' && action !== 'list')
      throw new OrchestrationError('validation', 'Invalid saved MCP action')
    if (purpose === 'execute' && action === 'list')
      throw new OrchestrationError('forbidden', 'List operations blocks cannot execute operations')
    const tool = normalizeSavedMcpOperationName({
      server,
      tool: value('tool'),
      operation: value('operation'),
      operationPolicy: value('operationPolicy'),
    })
    if (action === 'run' && (typeof tool !== 'string' || !tool.trim()))
      throw new OrchestrationError('validation', 'Saved MCP block requires an operation name')
    candidates.push({
      policy: normalizeMcpOperationPolicy(value('operationPolicy')),
      dynamicTarget: isMcpRuntimeReference(server) || isMcpRuntimeReference(connection),
      ...(value('operation') !== 'list' && typeof tool === 'string' && !isMcpRuntimeReference(tool)
        ? { toolName: tool }
        : {}),
    })
  } else if (block.type === 'agent' || block.type === 'mothership') {
    const tools = value('tools')
    if (!Array.isArray(tools))
      throw new OrchestrationError('forbidden', 'MCP attachments must be saved configuration')
    for (const tool of tools) {
      if (!isPlainRecord(tool) || tool.usageControl === 'none') continue
      if (tool.type !== 'mcp' && tool.type !== 'mcp-server-advanced') continue
      const binding = tool.type === 'mcp' ? resolveMcpToolBinding(tool) : tool.params
      if (!isPlainRecord(binding))
        throw new OrchestrationError('validation', 'Saved MCP attachment requires a server')
      if (!matchesTarget(binding.serverId, targetId, target.serverId)) continue
      if (binding.connectionId && !matchesTarget(binding.connectionId, targetId, targetId)) continue
      candidates.push({
        policy: normalizeMcpOperationPolicy(tool.operationPolicy),
        dynamicTarget:
          isMcpRuntimeReference(binding.serverId) || isMcpRuntimeReference(binding.connectionId),
        ...(tool.type === 'mcp' ? { toolName: binding.toolName as string } : {}),
      })
    }
  }
  if (!candidates.length)
    throw new OrchestrationError('forbidden', 'MCP server is not configured on this block')
  if (candidates.length > 1 && candidates.some((candidate) => candidate.toolName === undefined)) {
    throw new OrchestrationError(
      'forbidden',
      'MCP server matches overlapping attachments; configure one server binding'
    )
  }
  return {
    argumentsMode: candidates.every(
      ({ toolName, dynamicTarget }) =>
        !dynamicTarget && toolName !== undefined && !isMcpRuntimeReference(toolName)
    )
      ? 'generated'
      : 'json',
    allows: (name) =>
      candidates.some(
        ({ policy, toolName }) =>
          (toolName === undefined || toolName === name || isMcpRuntimeReference(toolName)) &&
          permitsMcpOperation(policy, target.serverId, name)
      ),
  }
}

export function requireMcpOperationAccess(access: McpOperationAccess, name: string): void {
  if (!access.allows(name))
    throw new OrchestrationError('forbidden', `MCP operation "${name}" is not permitted`)
}
