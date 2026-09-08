import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, mcpServers } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'
import { resolveMcpWorkspaceContext } from '@/lib/mcp/application/context'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import type { McpToolSchema } from '@/lib/mcp/types'

const MAX_MANAGED_MCP_CONNECTIONS = 500
const MAX_MANAGED_MCP_CATALOG_BYTES = 5 * 1024 * 1024

function requireMcpToolSchema(inputSchema: unknown): McpToolSchema {
  if (
    !inputSchema ||
    typeof inputSchema !== 'object' ||
    !('type' in inputSchema) ||
    inputSchema.type !== 'object'
  ) {
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
    if (
      !(await isCredentialGroupsAvailable({
        organizationId: ownerBilling.organizationId,
        ownerBilling,
      }))
    ) {
      return { servers: [], tools: [] }
    }
    const managedCatalogScope = () =>
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
    const metadataRows = await db
      .select({
        id: credential.id,
        serverId: mcpServers.id,
        serverName: mcpServers.name,
        serverDescription: mcpServers.description,
        managedConnectorId: mcpServers.managedConnectorId,
        email: credentialGroupEnrollment.email,
        toolSnapshotBytes:
          sql<number>`COALESCE(octet_length(${credential.mcpTools}::text), 0)`.mapWith(Number),
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
      .where(managedCatalogScope())
      .orderBy(asc(mcpServers.name), asc(credentialGroupEnrollment.email), asc(credential.id))
      .limit(MAX_MANAGED_MCP_CONNECTIONS + 1)

    if (metadataRows.length > MAX_MANAGED_MCP_CONNECTIONS) {
      throw new Error(
        `Managed MCP catalog exceeds the ${MAX_MANAGED_MCP_CONNECTIONS}-connection limit`
      )
    }
    const catalogBytes = metadataRows.reduce((total, row) => total + row.toolSnapshotBytes, 0)
    if (catalogBytes > MAX_MANAGED_MCP_CATALOG_BYTES) {
      throw new Error(
        `Managed MCP catalog exceeds the ${MAX_MANAGED_MCP_CATALOG_BYTES}-byte metadata limit`
      )
    }

    const toolRows =
      metadataRows.length === 0
        ? []
        : await db
            .select({ id: credential.id, tools: credential.mcpTools })
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
                managedCatalogScope(),
                inArray(
                  credential.id,
                  metadataRows.map((row) => row.id)
                )
              )
            )
    const toolsByConnectionId = new Map(toolRows.map((row) => [row.id, row.tools]))
    const rows = metadataRows.map((row) => {
      const tools = toolsByConnectionId.get(row.id)
      if (!tools) {
        throw new Error(`Managed MCP connection ${row.id} changed while loading its tool snapshot`)
      }
      if (!row.managedConnectorId) {
        throw new Error(`Managed MCP server ${row.serverId} has no connector ID`)
      }
      return {
        ...row,
        managedConnectorId: getManagedMcpConnector(row.managedConnectorId).id,
        tools,
      }
    })

    return {
      servers: rows.map((row) => ({
        id: row.id,
        workspaceId: context.workspaceId,
        name: `${row.serverName} — ${row.email}`,
        ...(row.serverDescription ? { description: row.serverDescription } : {}),
        transport: 'streamable-http' as const,
        authType: 'oauth' as const,
        managedConnectorId: row.managedConnectorId,
        enabled: true,
        connectionStatus: 'connected' as const,
        toolCount: row.tools.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      tools: rows.flatMap((row) => {
        return row.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: requireMcpToolSchema(tool.inputSchema),
          serverId: row.id,
          serverName: `${row.serverName} — ${row.email}`,
          managedConnectorId: row.managedConnectorId,
        }))
      }),
    }
  },
})
