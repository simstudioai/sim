import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, mcpServers } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { resolveMcpWorkspaceContext } from '@/lib/mcp/application/context'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import type { McpToolSchema } from '@/lib/mcp/types'

const MAX_MANAGED_MCP_CONNECTIONS = 500

function requireMcpToolSchema(inputSchema: Record<string, unknown>): McpToolSchema {
  if (inputSchema.type !== 'object') {
    throw new Error('Managed MCP tool snapshot must have an object input schema')
  }
  return inputSchema as McpToolSchema
}

export const listManagedMcpConnectionsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.listManagedConnections,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveMcpWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ context }) {
    const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(context.workspaceId)
    if (!(await isCredentialGroupsAvailable({ workspaceId: context.workspaceId, ownerBilling }))) {
      return { servers: [], tools: [] }
    }
    const rows = await db
      .select({
        id: credential.id,
        serverId: mcpServers.id,
        serverName: mcpServers.name,
        serverDescription: mcpServers.description,
        email: credentialGroupEnrollment.email,
        tools: credential.mcpTools,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      })
      .from(credential)
      .innerJoin(
        credentialGroupEnrollment,
        eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
      )
      .innerJoin(
        credentialGroup,
        eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId)
      )
      .innerJoin(mcpServers, eq(mcpServers.id, credential.mcpServerId))
      .where(
        and(
          eq(credential.workspaceId, context.workspaceId),
          eq(credential.type, 'managed_mcp'),
          eq(credential.managedOauthStatus, 'active'),
          eq(credentialGroup.status, 'active'),
          inArray(credentialGroupEnrollment.status, ['in_progress', 'completed']),
          eq(mcpServers.workspaceId, context.workspaceId),
          eq(mcpServers.authType, 'oauth'),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt),
          sql`${mcpServers.credentialGroupId} = ${credentialGroup.id}`
        )
      )
      .orderBy(asc(mcpServers.name), asc(credentialGroupEnrollment.email), asc(credential.id))
      .limit(MAX_MANAGED_MCP_CONNECTIONS + 1)

    if (rows.length > MAX_MANAGED_MCP_CONNECTIONS) {
      throw new Error(
        `Managed MCP catalog exceeds the ${MAX_MANAGED_MCP_CONNECTIONS}-connection limit`
      )
    }

    return {
      servers: rows.map((row) => ({
        id: row.id,
        workspaceId: context.workspaceId,
        name: `${row.serverName} — ${row.email}`,
        ...(row.serverDescription ? { description: row.serverDescription } : {}),
        transport: 'streamable-http' as const,
        authType: 'oauth' as const,
        enabled: true,
        connectionStatus: 'connected' as const,
        toolCount: row.tools?.length ?? 0,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      tools: rows.flatMap((row) => {
        if (!row.tools) throw new Error(`Managed MCP connection ${row.id} has no tool snapshot`)
        return row.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: requireMcpToolSchema(tool.inputSchema),
          serverId: row.id,
          serverName: `${row.serverName} — ${row.email}`,
        }))
      }),
    }
  },
})
