import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireCredentialGroupCredentialAccess } from '@/lib/credential-groups/application/authorization'
import { managedMcpCredentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  loadManagedMcpCredentialApplicationContext,
  loadManagedMcpRuntimeCredential,
  saveManagedMcpRuntimeTokens,
} from '@/lib/credentials/managed-mcp'
import { SIM_VIA_HEADER, serializeCallChain } from '@/lib/execution/call-chain'
import {
  coerceToolArguments,
  type ExecuteMcpToolResult,
  transformToolResult,
  validateToolArguments,
} from '@/lib/mcp/application/execute-tool'
import { getOrCreateOauthRow, loadPreregisteredClient } from '@/lib/mcp/oauth'
import { ManagedMcpOauthProvider } from '@/lib/mcp/oauth/managed-provider'
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
    const context = await loadManagedMcpCredentialApplicationContext(input.credentialId)
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
    const snapshot = runtime.tools.find((tool) => tool.name === input.toolName)
    if (!snapshot) {
      throw new OrchestrationError('not_found', 'Tool not found on the managed MCP connection')
    }
    const tool: McpTool = {
      name: snapshot.name,
      ...(snapshot.description ? { description: snapshot.description } : {}),
      inputSchema: requireToolSchema(snapshot.inputSchema),
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
      workspaceId: runtime.workspaceId,
      toolCall,
      extraHeaders,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      async loadAuthProvider() {
        const current = await loadManagedMcpRuntimeCredential(
          context.credentialId,
          context.workspaceId
        )
        const clientRow = await getOrCreateOauthRow({
          mcpServerId: current.mcpServerId,
          workspaceId: current.workspaceId,
        })
        const preregistered = await loadPreregisteredClient(current.mcpServerId)
        let tokenVersion: string | null = current.tokenVersion
        return new ManagedMcpOauthProvider({
          clientRow,
          preregistered,
          tokens: current.tokens,
          async onSaveTokens(tokens) {
            if (!tokenVersion) {
              throw new Error('Managed MCP credential grant is no longer active')
            }
            tokenVersion = await saveManagedMcpRuntimeTokens(
              current.credentialId,
              tokens,
              tokenVersion
            )
          },
        })
      },
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
