import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalSubject, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
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
import { loadMcpOperationAccess } from '@/lib/mcp/application/operation-access'
import { snapshotMcpTool } from '@/lib/mcp/presentation-metadata'
import { mcpService } from '@/lib/mcp/service'
import { compileMcpToolSchema } from '@/lib/mcp/tool-schema'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

export interface DiscoverManagedMcpToolsInput {
  workspaceId: string
  credentialId: string
  assertedServerId?: string
  signal?: AbortSignal
  onResolvedSecretTraceProvenance?: (provenance: ResolvedSecretTraceProvenanceV1) => void
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
    const subject = resolvePrincipalSubject(principal)
    if (subject?.kind === 'sim_user')
      await assertWorkspaceCapability(
        subject.userId,
        context.workspaceId,
        'integrations.manage',
        context.workspaceOrganizationId
      )
    await requireCredentialGroupCredentialAccess(principal, context, resourcePolicy)
  },
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    const userId = resolvePrincipalSubjectUserId(principal)
    const runtime = await loadManagedMcpRuntimeCredential(context.credentialId, context.workspaceId)
    if (
      runtime.mcpServerId !== context.mcpServerId ||
      runtime.credentialId !== context.credentialId
    )
      throw new OrchestrationError('forbidden', 'Managed MCP credential binding changed')
    const allowed = await loadMcpOperationAccess(principal, {
      workspaceId: context.workspaceId,
      serverId: runtime.mcpServerId,
      connectionId: runtime.credentialId,
      assertedServerId: input.assertedServerId,
    })
    const tools = await mcpService.discoverManagedMcpTools(
      runtime.mcpServerId,
      runtime.scope,
      {
        credentialId: runtime.credentialId,
        loadProvider: () => loadManagedMcpAuthProvider(runtime.credentialId, runtime.workspaceId),
      },
      input.signal,
      {
        requireComplete: true,
        provenanceScope: userId ? { userId, workspaceId: context.workspaceId } : undefined,
        onResolvedSecretTraceProvenance: input.onResolvedSecretTraceProvenance,
      }
    )
    await saveManagedMcpToolSnapshot(
      runtime.credentialId,
      tools.map(snapshotMcpTool),
      runtime.oauthConfigVersion,
      runtime.grantedAt
    )
    const authorized = tools.filter((tool) => allowed.allows(tool.name))
    for (const tool of authorized) compileMcpToolSchema(tool.inputSchema)
    return {
      tools: authorized.map((tool) => ({
        ...tool,
        serverId: runtime.credentialId,
        canonicalServerId: runtime.mcpServerId,
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
