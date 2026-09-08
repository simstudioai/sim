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
import { loadManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
import { mcpService } from '@/lib/mcp/service'

export interface DiscoverManagedMcpToolsInput {
  workspaceId: string
  credentialId: string
  signal?: AbortSignal
}

export const discoverManagedMcpToolsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.useManagedMcp,
  resolveContext: async ({ input }: { input: DiscoverManagedMcpToolsInput }) => {
    const context = await loadManagedMcpCredentialApplicationContext(
      input.credentialId,
      input.workspaceId
    )
    if (!context || context.workspaceId !== input.workspaceId) {
      throw new OrchestrationError('not_found', 'Managed MCP connection not found')
    }
    return context
  },
  authorizationOptions: { delegation: managedMcpCredentialDelegationPolicy },
  async authorizeResource({ principal, context, resourcePolicy }) {
    await requireCredentialGroupCredentialAccess(principal, context, resourcePolicy)
  },
  async execute({ input, context }) {
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
    return {
      tools: tools.map((tool) => ({
        ...tool,
        serverId: runtime.credentialId,
        serverName: runtime.mcpServerName,
      })),
    }
  },
  projectAudit: ({ context }) => ({
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credentialId,
    description: `Discovered tools from managed MCP credential ${context.credentialId}`,
    metadata: {
      credentialType: 'managed_mcp',
      mcpServerId: context.mcpServerId,
    },
  }),
})
