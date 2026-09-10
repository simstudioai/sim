import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SIM_VIA_HEADER, serializeCallChain } from '@/lib/execution/call-chain'
import {
  mcpServerExecutionDelegationPolicy,
  requireMcpCredentialUserId,
} from '@/lib/mcp/application/authorization'
import { resolveMcpServerContext } from '@/lib/mcp/application/context'
import {
  loadMcpOperationAccess,
  requireMcpOperationAccess,
} from '@/lib/mcp/application/operation-access'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { mcpService } from '@/lib/mcp/service'
import { compileMcpToolSchema } from '@/lib/mcp/tool-schema'
import type { McpTool, McpToolCall, McpToolResult } from '@/lib/mcp/types'
import {
  assertPermissionsAllowed,
  McpToolsNotAllowedError,
} from '@/ee/access-control/utils/permission-check'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('McpToolExecution')

interface SchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
}

export interface ExecuteMcpToolInput {
  workspaceId: string
  serverId: string
  toolName: string
  arguments?: Record<string, unknown>
  callChain?: string[]
  timeoutMs?: number
  signal?: AbortSignal
  onResolvedSecretTraceProvenance?: (provenance: ResolvedSecretTraceProvenanceV1) => void
}

export type ExecuteMcpToolResult =
  | { success: true; output: McpToolResult }
  | { success: false; error: string }

function hasType(value: unknown): value is SchemaProperty {
  return typeof value === 'object' && value !== null && 'type' in value
}

export function coerceToolArguments(
  tool: McpTool,
  input: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...input }
  if (!tool.inputSchema?.properties) return result

  for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
    if (!hasType(property)) continue
    const value = result[name]
    if (value === undefined || value === null) continue

    if ((property.type === 'number' || property.type === 'integer') && typeof value === 'string') {
      const numberValue = Number(value)
      if (!Number.isNaN(numberValue)) result[name] = numberValue
      continue
    }
    if (property.type === 'boolean' && typeof value === 'string') {
      if (value.toLowerCase() === 'true') result[name] = true
      if (value.toLowerCase() === 'false') result[name] = false
      continue
    }
    if (property.type !== 'array' || typeof value !== 'string') continue

    const trimmed = value.trim()
    if (!trimmed) {
      result[name] = []
      continue
    }
    try {
      const parsed: unknown = JSON.parse(trimmed)
      result[name] = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      result[name] = trimmed.includes(',')
        ? trimmed
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [trimmed]
    }
  }

  return result
}

/** Validates the complete discovered JSON Schema, including nested constraints and additional properties. */
export function validateToolArguments(tool: McpTool, args: Record<string, unknown>): void {
  if (!compileMcpToolSchema(tool.inputSchema)(args))
    throw new OrchestrationError('validation', 'Invalid MCP operation arguments')
}

export function transformToolResult(result: McpToolResult): ExecuteMcpToolResult {
  if (!result.isError) return { success: true, output: result }
  const firstContent = Array.isArray(result.content) ? result.content[0] : undefined
  const errorText =
    firstContent && typeof firstContent === 'object' && typeof firstContent.text === 'string'
      ? firstContent.text.trim()
      : ''
  return { success: false, error: errorText || 'Tool execution failed' }
}

export { McpToolsNotAllowedError }

export const executeMcpToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.executeTool,
  resolveContext: ({ input }: { input: ExecuteMcpToolInput }) =>
    resolveMcpServerContext(input.workspaceId, input.serverId),
  authorizationOptions: { delegation: mcpServerExecutionDelegationPolicy },
  async execute({ principal, input, context }): Promise<ExecuteMcpToolResult> {
    input.signal?.throwIfAborted()
    if (context.server.credentialGroupId) {
      throw new OrchestrationError(
        'conflict',
        'Credential Group MCP servers require an explicit managed connection ID'
      )
    }
    const userId = requireMcpCredentialUserId(principal)
    await assertPermissionsAllowed({
      userId,
      workspaceId: context.workspaceId,
      toolKind: 'mcp',
    })
    input.signal?.throwIfAborted()

    const allowed = await loadMcpOperationAccess(
      principal,
      {
        workspaceId: context.workspaceId,
        serverId: context.server.id,
      },
      'execute'
    )
    requireMcpOperationAccess(allowed, input.toolName)
    const tools = await mcpService.discoverServerTools(
      userId,
      context.server.id,
      context.workspaceId,
      'skip-cache',
      input.onResolvedSecretTraceProvenance,
      { signal: input.signal, requireComplete: true }
    )
    const tool = tools.find((candidate) => candidate.name === input.toolName)
    if (!tool) throw new OrchestrationError('not_found', 'Tool not found on the specified server')
    const args =
      allowed.argumentsMode === 'generated'
        ? coerceToolArguments(tool, { ...input.arguments })
        : { ...input.arguments }
    validateToolArguments(tool, args)
    input.signal?.throwIfAborted()
    const toolCall: McpToolCall = { name: input.toolName, arguments: args }
    const extraHeaders =
      input.callChain && input.callChain.length > 0
        ? { [SIM_VIA_HEADER]: serializeCallChain(input.callChain) }
        : undefined
    const current = await resolveMcpServerContext(context.workspaceId, context.server.id)
    if (!current.server.enabled || current.server.credentialGroupId)
      throw new OrchestrationError('forbidden', 'MCP server configuration changed during discovery')
    requireMcpOperationAccess(
      await loadMcpOperationAccess(
        principal,
        { workspaceId: context.workspaceId, serverId: context.server.id },
        'execute'
      ),
      input.toolName
    )
    const providerResult = await mcpService.executeTool(
      userId,
      context.server.id,
      toolCall,
      context.workspaceId,
      extraHeaders,
      input.onResolvedSecretTraceProvenance,
      { signal: input.signal, timeoutMs: input.timeoutMs }
    )
    input.signal?.throwIfAborted()
    const result = transformToolResult(providerResult)
    if (!result.success) return result

    try {
      const { PlatformEvents } = await import('@/lib/core/telemetry')
      PlatformEvents.mcpToolExecuted({
        serverId: context.server.id,
        toolName: input.toolName,
        status: 'success',
        workspaceId: context.workspaceId,
      })
    } catch (error) {
      logger.warn('Failed to record MCP tool execution telemetry', {
        error: getErrorMessage(error),
        serverId: context.server.id,
        toolName: input.toolName,
        workspaceId: context.workspaceId,
      })
    }

    return result
  },
})
