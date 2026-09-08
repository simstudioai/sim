import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireCredentialGroupCredentialAccess } from '@/lib/credential-groups/application/authorization'
import { managedMcpCredentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  loadManagedMcpCredentialApplicationContext,
  loadManagedMcpRuntimeCredential,
  saveManagedMcpToolSnapshot,
} from '@/lib/credentials/managed-mcp'
import { SIM_VIA_HEADER, serializeCallChain } from '@/lib/execution/call-chain'
import {
  coerceToolArguments,
  type ExecuteMcpToolResult,
  transformToolResult,
  validateToolArguments,
} from '@/lib/mcp/application/execute-tool'
import { loadManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
import { mcpService } from '@/lib/mcp/service'
import type { McpTool, McpToolCall, McpToolSchema } from '@/lib/mcp/types'

export interface ExecuteManagedMcpToolInput {
  workspaceId: string
  credentialId: string
  toolName: string
  arguments?: Record<string, unknown>
  callChain?: string[]
  timeoutMs?: number
  signal?: AbortSignal
}

function requireToolSchema(value: unknown): McpToolSchema {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'object') {
    throw new OrchestrationError('validation', 'Managed MCP tool schema is invalid')
  }
  return value as McpToolSchema
}

export const executeManagedMcpToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.useManagedMcp,
  resolveContext: async ({ input }: { input: ExecuteManagedMcpToolInput }) => {
    const context = await loadManagedMcpCredentialApplicationContext(
      input.credentialId,
      input.workspaceId
    )
    if (!context) throw new OrchestrationError('not_found', 'Managed MCP connection not found')
    if (context.workspaceId !== input.workspaceId) {
      throw new OrchestrationError('not_found', 'Managed MCP connection not found')
    }
    return context
  },
  authorizationOptions: { delegation: managedMcpCredentialDelegationPolicy },
  async authorizeResource({ principal, context, resourcePolicy }) {
    await requireCredentialGroupCredentialAccess(principal, context, resourcePolicy)
  },
  async execute({ input, context }): Promise<ExecuteMcpToolResult> {
    input.signal?.throwIfAborted()
    const runtime = await loadManagedMcpRuntimeCredential(context.credentialId, context.workspaceId)
    const tools = await mcpService.discoverManagedMcpTools(
      runtime.mcpServerId,
      runtime.scope,
      {
        credentialId: runtime.credentialId,
        loadProvider: () => loadManagedMcpAuthProvider(runtime.credentialId, runtime.workspaceId),
      },
      input.signal,
      { requireComplete: true }
    )
    await saveManagedMcpToolSnapshot(
      runtime.credentialId,
      tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
      })),
      runtime.oauthConfigVersion,
      runtime.grantedAt
    )
    const discovered = tools.find((tool) => tool.name === input.toolName)
    if (!discovered) {
      throw new OrchestrationError('not_found', 'Tool not found on the managed MCP connection')
    }
    const tool: McpTool = {
      name: discovered.name,
      ...(discovered.description ? { description: discovered.description } : {}),
      inputSchema: requireToolSchema(discovered.inputSchema),
      serverId: runtime.credentialId,
      serverName: runtime.mcpServerName,
    }
    const args = coerceToolArguments(tool, { ...input.arguments })
    validateToolArguments(tool, args)
    const toolCall: McpToolCall = { name: input.toolName, arguments: args }
    const extraHeaders =
      input.callChain && input.callChain.length > 0
        ? { [SIM_VIA_HEADER]: serializeCallChain(input.callChain) }
        : undefined
    const providerResult = await mcpService.executeManagedMcpTool({
      connectionId: runtime.credentialId,
      serverId: runtime.mcpServerId,
      scope: runtime.scope,
      toolCall,
      extraHeaders,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      loadAuthProvider: () => loadManagedMcpAuthProvider(context.credentialId, context.workspaceId),
    })
    input.signal?.throwIfAborted()
    return transformToolResult(providerResult)
  },
  projectAudit: ({ input, context }) => ({
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credentialId,
    description: `Executed managed MCP tool ${input.toolName}`,
    metadata: {
      credentialType: 'managed_mcp',
      mcpServerId: context.mcpServerId,
      toolName: input.toolName,
    },
  }),
})
