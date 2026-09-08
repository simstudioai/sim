import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, mcpServers } from '@sim/db/schema'
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'

export const MAX_CREDENTIAL_GROUP_MCP_CONNECTION_PAGE_SIZE = 100

export interface CredentialGroupMcpConnectionReference {
  credentialId: string
  email: string
  displayName: string
  mcpServerId: string
  mcpServerName: string
  toolNames: string[]
}

export class CredentialGroupMcpConnectionCursorNotFoundError extends Error {
  constructor() {
    super('Credential group MCP connection cursor not found')
    this.name = 'CredentialGroupMcpConnectionCursorNotFoundError'
  }
}

interface ListCredentialGroupMcpConnectionReferencesInput {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  limit: number
  cursor?: string
  email?: string
  mcpServerId?: string
  connectorId?: string
}

function decodeToolNames(value: unknown): string[] {
  const decoded = credential.mcpTools.mapFromDriverValue(value)
  if (!Array.isArray(decoded) || !decoded.every((name) => typeof name === 'string')) {
    throw new Error('Managed MCP tool name projection is invalid')
  }
  return decoded
}

/** Lists one bounded page of active managed MCP connections without selecting token material. */
export async function listCredentialGroupMcpConnectionReferences({
  workspaceId,
  organizationId,
  credentialGroupId,
  limit,
  cursor,
  email,
  mcpServerId,
  connectorId,
}: ListCredentialGroupMcpConnectionReferencesInput): Promise<{
  mcpConnections: CredentialGroupMcpConnectionReference[]
  nextCursor: string | null
}> {
  const ownerScope = resourceScopeFromOwner({ workspaceId, organizationId })
  const scope = () =>
    and(
      resourceScopeCondition(credential, ownerScope),
      eq(credential.type, 'managed_mcp'),
      eq(credential.managedOauthStatus, 'active'),
      eq(credential.mcpOauthConfigVersion, mcpServers.oauthConfigVersion),
      eq(credentialGroup.id, credentialGroupId),
      resourceScopeCondition(credentialGroup, ownerScope),
      eq(credentialGroup.status, 'active'),
      inArray(credentialGroupEnrollment.status, ['in_progress', 'completed']),
      resourceScopeCondition(mcpServers, ownerScope),
      organizationId ? isNotNull(credentialGroupEnrollment.userId) : undefined,
      eq(mcpServers.authType, 'oauth'),
      eq(mcpServers.enabled, true),
      isNull(mcpServers.deletedAt),
      sql`${mcpServers.credentialGroupId} = ${credentialGroup.id}`,
      email ? eq(credentialGroupEnrollment.email, email) : undefined,
      mcpServerId ? eq(mcpServers.id, mcpServerId) : undefined,
      connectorId ? eq(mcpServers.managedConnectorId, connectorId) : undefined
    )

  let cursorPosition: { id: string; createdAt: Date } | undefined
  if (cursor) {
    const [cursorRow] = await db
      .select({ id: credential.id, createdAt: credential.createdAt })
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
      .where(and(eq(credential.id, cursor), scope()))
      .limit(1)
    if (!cursorRow) throw new CredentialGroupMcpConnectionCursorNotFoundError()
    cursorPosition = cursorRow
  }

  const rows = await db
    .select({
      id: credential.id,
      email: credentialGroupEnrollment.email,
      displayName: credential.displayName,
      mcpServerId: mcpServers.id,
      mcpServerName: mcpServers.name,
      managedConnectorId: mcpServers.managedConnectorId,
      hasToolSnapshot: sql<boolean>`${credential.mcpTools} IS NOT NULL`,
      toolNames:
        sql`COALESCE(jsonb_path_query_array(${credential.mcpTools}, '$[*].name'), '[]'::jsonb)`.mapWith(
          decodeToolNames
        ),
      createdAt: credential.createdAt,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(mcpServers, eq(mcpServers.id, credential.mcpServerId))
    .where(
      and(
        scope(),
        cursorPosition
          ? or(
              gt(credential.createdAt, cursorPosition.createdAt),
              and(
                eq(credential.createdAt, cursorPosition.createdAt),
                gt(credential.id, cursorPosition.id)
              )
            )
          : undefined
      )
    )
    .orderBy(asc(credential.createdAt), asc(credential.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? pageRows.at(-1)?.id : null
  if (hasMore && !nextCursor) throw new Error('MCP connection page cursor could not be derived')

  return {
    mcpConnections: pageRows.map((row) => {
      if (!row.hasToolSnapshot) {
        throw new Error(`Managed MCP connection ${row.id} has no tool snapshot`)
      }
      if (!row.managedConnectorId) {
        throw new Error(`Managed MCP server ${row.mcpServerId} has no connector ID`)
      }
      getManagedMcpConnector(row.managedConnectorId)
      if (row.toolNames.some((name) => typeof name !== 'string' || !name.trim())) {
        throw new Error(`Managed MCP connection ${row.id} has invalid tool metadata`)
      }
      return {
        credentialId: row.id,
        email: row.email,
        displayName: row.displayName,
        mcpServerId: row.mcpServerId,
        mcpServerName: row.mcpServerName,
        toolNames: row.toolNames,
      }
    }),
    nextCursor: nextCursor ?? null,
  }
}
