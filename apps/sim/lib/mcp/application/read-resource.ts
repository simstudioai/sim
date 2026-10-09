import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireCredentialGroupCredentialAccess } from '@/lib/credential-groups/application/authorization'
import { discoverManagedMcpToolsUseCase } from '@/lib/credentials/application/discover-managed-mcp-tools'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  loadManagedMcpCredentialApplicationContext,
  loadManagedMcpRuntimeCredential,
} from '@/lib/credentials/managed-mcp'
import { resolveMcpServerContext } from '@/lib/mcp/application/context'
import { loadManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import { getMcpAppResourceUri } from '@/lib/mcp/presentation-metadata'
import { mcpService } from '@/lib/mcp/service'
import type { McpTool } from '@/lib/mcp/types'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

interface ReadMcpResourceInput {
  workspaceId: string
  connectionId: string
  toolName: string
  uri: string
  appUri?: string
  onResolvedSecretTraceProvenance?: (provenance: ResolvedSecretTraceProvenanceV1) => void
  signal?: AbortSignal
}

function requireOriginTool(tools: McpTool[], input: ReadMcpResourceInput) {
  const tool = tools.find((candidate) => candidate.name === input.toolName)
  if (!tool || (input.appUri !== undefined && getMcpAppResourceUri(tool) !== input.appUri))
    throw new OrchestrationError(
      'forbidden',
      'The originating MCP operation is no longer available'
    )
  if (!input.uri || input.uri.length > 2048)
    throw new OrchestrationError('validation', 'Invalid MCP resource URI')
  return tool
}

/** Resource reads share current connection authorization with tool execution. */
export const readMcpResource = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.readResource,
  authorizationOptions: {},
  resolveContext: ({ input }: { input: ReadMcpResourceInput }) =>
    resolveMcpServerContext(input.workspaceId, input.connectionId),
  async execute({ principal, input, context }) {
    const { tools } = await discoverMcpServerToolsUseCase.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        serverId: context.server.id,
        requireComplete: true,
        signal: input.signal,
      },
    })
    requireOriginTool(tools, input)
    const current = await resolveMcpServerContext(context.workspaceId, context.server.id)
    if (!current.server.enabled || current.server.credentialGroupId)
      throw new OrchestrationError('forbidden', 'MCP server is unavailable')
    return mcpService.readResource({
      serverId: context.server.id,
      workspaceId: context.workspaceId,
      userId: principal.userId,
      uri: input.uri,
      includeListingMetadata: input.appUri === input.uri,
      onResolvedSecretTraceProvenance: input.onResolvedSecretTraceProvenance,
      signal: input.signal,
    })
  },
})

export const readManagedMcpResource = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.readManagedMcpResource,
  authorizationOptions: {},
  resolveContext: async ({ input }: { input: ReadMcpResourceInput }) => {
    const context = await loadManagedMcpCredentialApplicationContext(
      input.connectionId,
      input.workspaceId
    )
    if (!context || context.workspaceId !== input.workspaceId)
      throw new OrchestrationError('not_found', 'Managed MCP connection not found')
    return context
  },
  async authorizeResource({ principal, context, resourcePolicy }) {
    await assertWorkspaceCapability(
      principal.userId,
      context.workspaceId,
      'integrations.manage',
      context.workspaceOrganizationId
    )
    await requireCredentialGroupCredentialAccess(principal, context, resourcePolicy)
  },
  async execute({ principal, input, context }) {
    const before = await loadManagedMcpRuntimeCredential(context.credentialId, context.workspaceId)
    const { tools } = await discoverManagedMcpToolsUseCase.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        credentialId: context.credentialId,
        signal: input.signal,
        onResolvedSecretTraceProvenance: input.onResolvedSecretTraceProvenance,
      },
    })
    requireOriginTool(tools, input)
    const current = await loadManagedMcpRuntimeCredential(context.credentialId, context.workspaceId)
    if (
      current.mcpServerId !== before.mcpServerId ||
      current.oauthConfigVersion !== before.oauthConfigVersion ||
      current.grantedAt.getTime() !== before.grantedAt.getTime()
    )
      throw new OrchestrationError('forbidden', 'Managed MCP credential changed during discovery')
    await requireCredentialGroupCredentialAccess(
      principal,
      context,
      credentialOperations.readManagedMcpResource.resourcePolicy
    )
    return mcpService.readResource({
      serverId: current.mcpServerId,
      workspaceId: context.workspaceId,
      userId: principal.userId,
      uri: input.uri,
      includeListingMetadata: input.appUri === input.uri,
      onResolvedSecretTraceProvenance: input.onResolvedSecretTraceProvenance,
      signal: input.signal,
      managed: {
        connectionId: context.credentialId,
        scope: current.scope,
        loadAuthProvider: () =>
          loadManagedMcpAuthProvider(context.credentialId, context.workspaceId),
      },
    })
  },
  projectAudit: ({ context }) => ({
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credentialId,
  }),
})
