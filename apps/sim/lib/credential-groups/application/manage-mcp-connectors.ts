import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  requireCredentialGroupSettingsAvailable,
  resolveCredentialGroupSettingsContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  type CreateManagedMcpConnectorInput,
  createManagedMcpConnector,
  deleteManagedMcpConnector,
  ManagedMcpConnectorError,
  type UpdateManagedMcpConnectorInput,
  updateManagedMcpConnector,
} from '@/lib/credential-groups/managed-mcp-service'
import { clearCredentialGroupMcpOAuthAttempts } from '@/lib/credential-groups/mcp-oauth-state'
import { evictMcpServerConnections } from '@/lib/mcp/connection-pool'
import { mcpService } from '@/lib/mcp/service'

interface ManagedMcpConnectorTargetInput {
  assertedWorkspaceId: string
  credentialGroupId: string
}

function projectManagedMcpConnectorError(error: unknown): never {
  if (error instanceof ManagedMcpConnectorError) {
    throw new OrchestrationError(
      error.code === 'bad_gateway' ? 'validation' : error.code,
      error.message
    )
  }
  throw error
}

async function applyManagedMcpConnectorEffects(params: {
  workspaceId: string
  serverIds: string[]
  connectionIds: string[]
  reason: string
}): Promise<void> {
  await mcpService.clearCache(params.workspaceId)
  await clearCredentialGroupMcpOAuthAttempts(params.serverIds)
  await Promise.all([
    ...params.serverIds.map((serverId) => evictMcpServerConnections(serverId, params.reason)),
    ...params.connectionIds.map((connectionId) =>
      evictMcpServerConnections(connectionId, params.reason)
    ),
  ])
}

export interface CreateCredentialGroupMcpConnectorInput extends ManagedMcpConnectorTargetInput {
  connector: CreateManagedMcpConnectorInput
}

export const createCredentialGroupMcpConnector = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.createMcpConnector,
  resolveContext: ({ input }: { input: CreateCredentialGroupMcpConnectorInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    try {
      return await createManagedMcpConnector({
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
        userId: principal.userId,
        input: input.connector,
      })
    } catch (error) {
      projectManagedMcpConnectorError(error)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_ADDED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.mcpServer.id,
    resourceName: result.mcpServer.name,
    description: `Added managed MCP connector "${result.mcpServer.name}"`,
  }),
  afterSuccess: ({ context, result }) =>
    applyManagedMcpConnectorEffects({
      workspaceId: context.workspaceId,
      serverIds: [],
      connectionIds: [],
      reason: 'managed connector added',
    }),
})

export interface UpdateCredentialGroupMcpConnectorInput extends ManagedMcpConnectorTargetInput {
  connectorId: ManagedMcpConnectorId
  update: UpdateManagedMcpConnectorInput
}

export const updateCredentialGroupMcpConnector = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.updateMcpConnector,
  resolveContext: ({ input }: { input: UpdateCredentialGroupMcpConnectorInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    try {
      return await updateManagedMcpConnector({
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
        connectorId: input.connectorId,
        input: input.update,
      })
    } catch (error) {
      projectManagedMcpConnectorError(error)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_UPDATED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.mcpServer.id,
    resourceName: result.mcpServer.name,
    description: `Updated managed MCP connector "${result.mcpServer.name}"`,
  }),
  afterSuccess: ({ context, result }) =>
    applyManagedMcpConnectorEffects({
      workspaceId: context.workspaceId,
      serverIds: result.resetMcpServerIds,
      connectionIds: result.retiredMcpConnectionIds,
      reason: 'managed connector configuration changed',
    }),
})

export interface DeleteCredentialGroupMcpConnectorInput extends ManagedMcpConnectorTargetInput {
  connectorId: ManagedMcpConnectorId
}

export const deleteCredentialGroupMcpConnector = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.deleteMcpConnector,
  resolveContext: ({ input }: { input: DeleteCredentialGroupMcpConnectorInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    try {
      return await deleteManagedMcpConnector({
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
        connectorId: input.connectorId,
      })
    } catch (error) {
      projectManagedMcpConnectorError(error)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.MCP_SERVER_REMOVED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.mcpServer.id,
    resourceName: result.mcpServer.name,
    description: `Removed managed MCP connector "${result.mcpServer.name}"`,
  }),
  afterSuccess: ({ context, result }) =>
    applyManagedMcpConnectorEffects({
      workspaceId: context.workspaceId,
      serverIds: result.serverIds,
      connectionIds: result.retiredMcpConnectionIds,
      reason: 'managed connector removed',
    }),
})
