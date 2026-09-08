import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  mcpServerOauth,
  mcpServers,
} from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import {
  resourceScopeColumns,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  getManagedMcpConnector,
  type ManagedMcpConnectorId,
  requireManagedMcpConnectorUrl,
} from '@/lib/credential-groups/managed-mcp-connectors'
import type { DbOrTx } from '@/lib/db/types'
import {
  McpDnsResolutionError,
  McpDomainNotAllowedError,
  McpSsrfError,
  validateMcpDomain,
  validateMcpServerSsrf,
} from '@/lib/mcp/domain-check'
import { generateMcpServerId } from '@/lib/mcp/utils'

export class ManagedMcpConnectorError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'not_found' | 'conflict' | 'forbidden' | 'bad_gateway'
  ) {
    super(message)
    this.name = 'ManagedMcpConnectorError'
  }
}

export interface ManagedMcpConnectorSummary {
  id: string
  name: string
  description: string | null
  authType: string
  enabled: boolean
  managedConnectorId: ManagedMcpConnectorId
}

export type CreateManagedMcpConnectorInput =
  | { connectorId: 'fireflies' | 'granola' }
  | {
      connectorId: 'databricks'
      name: string
      url: string
      oauthClientId: string
      oauthClientSecret?: string
    }

export interface UpdateManagedMcpConnectorInput {
  name?: string
  url?: string
  oauthClientId?: string
  oauthClientSecret?: string | null
}

export interface ManagedMcpConnectorMutationResult {
  mcpServer: ManagedMcpConnectorSummary
  retiredMcpConnectionIds: string[]
  resetMcpServerIds: string[]
}

function toSummary(row: typeof mcpServers.$inferSelect): ManagedMcpConnectorSummary {
  if (!row.managedConnectorId) {
    throw new Error(`Credential Group MCP server ${row.id} has no managed connector ID`)
  }
  const connector = getManagedMcpConnector(row.managedConnectorId)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    authType: row.authType,
    enabled: row.enabled,
    managedConnectorId: connector.id,
  }
}

/** Loads setup fields without reading the stored OAuth client secret. */
export async function loadOrganizationDatabricksSetup(
  organizationId: string,
  credentialGroupId: string
) {
  const [server] = await db
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
      url: mcpServers.url,
      oauthClientId: mcpServers.oauthClientId,
      hasOauthClientSecret: sql<boolean>`${mcpServers.oauthClientSecret} IS NOT NULL`,
      enabled: mcpServers.enabled,
    })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.organizationId, organizationId),
        eq(mcpServers.credentialGroupId, credentialGroupId),
        eq(mcpServers.managedConnectorId, 'databricks'),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
  if (!server) throw new ManagedMcpConnectorError('Databricks has not been added', 'not_found')
  return server
}

async function validateServerUrl(url: string): Promise<void> {
  try {
    validateMcpDomain(url)
    await validateMcpServerSsrf(url)
  } catch (error) {
    if (error instanceof McpDomainNotAllowedError || error instanceof McpSsrfError) {
      throw new ManagedMcpConnectorError(error.message, 'forbidden')
    }
    if (error instanceof McpDnsResolutionError) {
      throw new ManagedMcpConnectorError(error.message, 'bad_gateway')
    }
    throw error
  }
}

function resolveManagedMcpConnectorUrl(
  connectorId: ManagedMcpConnectorId,
  rawUrl?: string
): string {
  try {
    return requireManagedMcpConnectorUrl(connectorId, rawUrl)
  } catch (error) {
    if (error instanceof Error) {
      throw new ManagedMcpConnectorError(error.message, 'validation')
    }
    throw error
  }
}

async function retireManagedMcpCredentials(
  credentialGroupId: string,
  mcpServerIds: string[],
  executor: DbOrTx
): Promise<string[]> {
  if (mcpServerIds.length === 0) return []
  const enrollmentIds = executor
    .select({ id: credentialGroupEnrollment.id })
    .from(credentialGroupEnrollment)
    .where(eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId))
  const retired = await executor
    .update(credential)
    .set({
      managedOauthStatus: 'revoked',
      encryptedOauthTokenSet: null,
      accessTokenExpiresAt: null,
      mcpTools: null,
      mcpToolsRefreshedAt: null,
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(credential.type, 'managed_mcp'),
        inArray(credential.credentialGroupEnrollmentId, enrollmentIds),
        inArray(credential.mcpServerId, mcpServerIds)
      )
    )
    .returning({ id: credential.id })
  return retired.map((row) => row.id)
}

export async function createManagedMcpConnector(params: {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  userId: string
  input: CreateManagedMcpConnectorInput
}): Promise<ManagedMcpConnectorMutationResult> {
  const scope = resourceScopeFromOwner(params)
  const connector = getManagedMcpConnector(params.input.connectorId)
  const url = resolveManagedMcpConnectorUrl(
    connector.id,
    params.input.connectorId === 'databricks' ? params.input.url : undefined
  )
  await validateServerUrl(url)
  const serverId = generateMcpServerId(
    scope.kind === 'workspace' ? scope.workspaceId : resourceScopeKey(scope),
    url
  )
  const oauthClientId =
    params.input.connectorId === 'databricks' ? params.input.oauthClientId.trim() : null
  const oauthClientSecret =
    params.input.connectorId === 'databricks' && params.input.oauthClientSecret
      ? (await encryptSecret(params.input.oauthClientSecret)).encrypted
      : null
  const name = params.input.connectorId === 'databricks' ? params.input.name.trim() : connector.name
  if (!name)
    throw new ManagedMcpConnectorError('Managed MCP connector name is required', 'validation')
  if (params.input.connectorId === 'databricks' && !oauthClientId) {
    throw new ManagedMcpConnectorError('Databricks OAuth Client ID is required', 'validation')
  }

  try {
    const mcpServer = await db.transaction(async (tx) => {
      const [group] = await tx
        .select({ id: credentialGroup.id })
        .from(credentialGroup)
        .where(
          and(
            eq(credentialGroup.id, params.credentialGroupId),
            resourceScopeCondition(credentialGroup, scope)
          )
        )
        .limit(1)
        .for('update')
      if (!group) throw new ManagedMcpConnectorError('Credential group not found', 'not_found')

      const [existingProvider] = await tx
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(
          and(
            resourceScopeCondition(mcpServers, scope),
            eq(mcpServers.credentialGroupId, params.credentialGroupId),
            eq(mcpServers.managedConnectorId, connector.id),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)
      if (existingProvider) {
        throw new ManagedMcpConnectorError(
          `${connector.name} is already configured for this Credential Group`,
          'conflict'
        )
      }

      const [liveServerWithUrl] = await tx
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(
          and(
            resourceScopeCondition(mcpServers, scope),
            eq(mcpServers.url, url),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)
        .for('update')
      if (liveServerWithUrl) {
        throw new ManagedMcpConnectorError(
          'An MCP server with this URL already exists. Remove it from MCP settings first.',
          'conflict'
        )
      }

      const [existingUrl] = await tx
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.id, serverId), resourceScopeCondition(mcpServers, scope)))
        .limit(1)
        .for('update')
      const now = new Date()
      if (existingUrl) {
        const [revived] = await tx
          .update(mcpServers)
          .set({
            credentialGroupId: params.credentialGroupId,
            managedConnectorId: connector.id,
            createdBy: params.userId,
            name,
            description: connector.description,
            transport: 'streamable-http',
            url,
            authType: 'oauth',
            oauthClientId,
            oauthClientSecret,
            oauthConfigVersion: existingUrl.oauthConfigVersion + 1,
            headers: {},
            enabled: true,
            connectionStatus: 'disconnected',
            lastConnected: null,
            lastError: null,
            deletedAt: null,
            updatedAt: now,
          })
          .where(eq(mcpServers.id, serverId))
          .returning()
        if (!revived) throw new Error('Managed MCP server revival returned no row')
        return revived
      }

      const [created] = await tx
        .insert(mcpServers)
        .values({
          id: serverId,
          ...resourceScopeColumns(scope),
          credentialGroupId: params.credentialGroupId,
          managedConnectorId: connector.id,
          createdBy: params.userId,
          name,
          description: connector.description,
          transport: 'streamable-http',
          url,
          authType: 'oauth',
          oauthClientId,
          oauthClientSecret,
          headers: {},
          enabled: true,
          connectionStatus: 'disconnected',
          lastConnected: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      if (!created) throw new Error('Managed MCP server insert returned no row')
      return created
    })
    return {
      mcpServer: toSummary(mcpServer),
      retiredMcpConnectionIds: [],
      resetMcpServerIds: [],
    }
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new ManagedMcpConnectorError(
        `${connector.name} is already configured for this Credential Group`,
        'conflict'
      )
    }
    throw error
  }
}

export async function updateManagedMcpConnector(params: {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  connectorId: ManagedMcpConnectorId
  input: UpdateManagedMcpConnectorInput
}): Promise<ManagedMcpConnectorMutationResult> {
  const scope = resourceScopeFromOwner(params)
  if (params.connectorId !== 'databricks') {
    throw new ManagedMcpConnectorError(
      'Only Databricks connector settings can be changed',
      'validation'
    )
  }
  const current = await db
    .select()
    .from(mcpServers)
    .where(
      and(
        resourceScopeCondition(mcpServers, scope),
        eq(mcpServers.credentialGroupId, params.credentialGroupId),
        eq(mcpServers.managedConnectorId, params.connectorId),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!current) throw new ManagedMcpConnectorError('Managed MCP connector not found', 'not_found')
  const url = resolveManagedMcpConnectorUrl(
    'databricks',
    params.input.url ?? current.url ?? undefined
  )
  if (url !== current.url) await validateServerUrl(url)
  const encryptedSecret =
    params.input.oauthClientSecret === undefined
      ? undefined
      : params.input.oauthClientSecret === null
        ? null
        : (await encryptSecret(params.input.oauthClientSecret)).encrypted

  const result = await db.transaction(async (tx) => {
    const [group] = await tx
      .select({ id: credentialGroup.id })
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.id, params.credentialGroupId),
          resourceScopeCondition(credentialGroup, scope)
        )
      )
      .limit(1)
      .for('update')
    if (!group) throw new ManagedMcpConnectorError('Credential group not found', 'not_found')

    const [locked] = await tx
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, current.id),
          resourceScopeCondition(mcpServers, scope),
          eq(mcpServers.credentialGroupId, params.credentialGroupId),
          eq(mcpServers.managedConnectorId, 'databricks'),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!locked) throw new ManagedMcpConnectorError('Managed MCP connector not found', 'not_found')
    const urlChanged = url !== locked.url
    const targetServerId = generateMcpServerId(
      scope.kind === 'workspace' ? scope.workspaceId : resourceScopeKey(scope),
      url
    )
    if (urlChanged && targetServerId === locked.id) {
      throw new Error(`MCP server ID collision for ${locked.id}`)
    }
    if (urlChanged) {
      const [liveServerWithUrl] = await tx
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(
          and(
            resourceScopeCondition(mcpServers, scope),
            eq(mcpServers.url, url),
            ne(mcpServers.id, locked.id),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)
        .for('update')
      if (liveServerWithUrl) {
        throw new ManagedMcpConnectorError(
          'An MCP server with this URL already exists. Remove it from MCP settings first.',
          'conflict'
        )
      }
    }
    const nextName = params.input.name?.trim() ?? locked.name
    const nextOauthClientId = params.input.oauthClientId?.trim() ?? locked.oauthClientId
    if (!nextName) {
      throw new ManagedMcpConnectorError('Databricks name is required', 'validation')
    }
    if (!nextOauthClientId) {
      throw new ManagedMcpConnectorError('Databricks OAuth Client ID is required', 'validation')
    }
    const nextOauthClientSecret =
      encryptedSecret === undefined ? locked.oauthClientSecret : encryptedSecret
    const changedCredentials =
      urlChanged || nextOauthClientId !== locked.oauthClientId || encryptedSecret !== undefined
    const retiredMcpConnectionIds = changedCredentials
      ? await retireManagedMcpCredentials(params.credentialGroupId, [locked.id], tx)
      : []
    if (changedCredentials) {
      await tx.delete(mcpServerOauth).where(eq(mcpServerOauth.mcpServerId, locked.id))
    }
    const now = new Date()
    if (!urlChanged) {
      const [updated] = await tx
        .update(mcpServers)
        .set({
          name: nextName,
          oauthClientId: nextOauthClientId,
          oauthConfigVersion: changedCredentials
            ? locked.oauthConfigVersion + 1
            : locked.oauthConfigVersion,
          ...(encryptedSecret !== undefined ? { oauthClientSecret: encryptedSecret } : {}),
          ...(changedCredentials
            ? { connectionStatus: 'disconnected', lastConnected: null, lastError: null }
            : {}),
          updatedAt: now,
        })
        .where(eq(mcpServers.id, locked.id))
        .returning()
      if (!updated) throw new Error('Managed MCP server update returned no row')
      return {
        mcpServer: toSummary(updated),
        retiredMcpConnectionIds,
        resetMcpServerIds: changedCredentials ? [locked.id] : [],
      }
    }

    const [target] = await tx
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, targetServerId), resourceScopeCondition(mcpServers, scope)))
      .limit(1)
      .for('update')
    if (target?.deletedAt === null) {
      throw new ManagedMcpConnectorError(
        'An MCP server with this URL already exists. Remove it from MCP settings first.',
        'conflict'
      )
    }

    await tx
      .update(mcpServers)
      .set({ enabled: false, deletedAt: now, updatedAt: now })
      .where(eq(mcpServers.id, locked.id))
    if (target) {
      await tx.delete(mcpServerOauth).where(eq(mcpServerOauth.mcpServerId, target.id))
    }
    const rowValues = {
      credentialGroupId: params.credentialGroupId,
      managedConnectorId: 'databricks' as const,
      createdBy: locked.createdBy,
      name: nextName,
      description: getManagedMcpConnector('databricks').description,
      transport: 'streamable-http',
      url,
      authType: 'oauth',
      oauthClientId: nextOauthClientId,
      oauthClientSecret: nextOauthClientSecret,
      oauthConfigVersion: locked.oauthConfigVersion + 1,
      headers: {},
      enabled: true,
      connectionStatus: 'disconnected',
      lastConnected: null,
      lastError: null,
      deletedAt: null,
      updatedAt: now,
    }
    const [replacement] = target
      ? await tx.update(mcpServers).set(rowValues).where(eq(mcpServers.id, target.id)).returning()
      : await tx
          .insert(mcpServers)
          .values({
            id: targetServerId,
            ...resourceScopeColumns(scope),
            ...rowValues,
            createdAt: now,
          })
          .returning()
    if (!replacement) throw new Error('Managed MCP server replacement returned no row')
    return {
      mcpServer: toSummary(replacement),
      retiredMcpConnectionIds,
      resetMcpServerIds: [locked.id, replacement.id],
    }
  })
  return result
}

export async function deleteManagedMcpConnector(params: {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  connectorId: ManagedMcpConnectorId
}): Promise<{
  mcpServer: ManagedMcpConnectorSummary
  serverIds: string[]
  retiredMcpConnectionIds: string[]
}> {
  const scope = resourceScopeFromOwner(params)
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({ id: credentialGroup.id })
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.id, params.credentialGroupId),
          resourceScopeCondition(credentialGroup, scope)
        )
      )
      .limit(1)
      .for('update')
    if (!group) throw new ManagedMcpConnectorError('Credential group not found', 'not_found')

    const [server] = await tx
      .select()
      .from(mcpServers)
      .where(
        and(
          resourceScopeCondition(mcpServers, scope),
          eq(mcpServers.credentialGroupId, params.credentialGroupId),
          eq(mcpServers.managedConnectorId, params.connectorId),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!server) throw new ManagedMcpConnectorError('Managed MCP connector not found', 'not_found')
    const retiredMcpConnectionIds = await retireManagedMcpCredentials(
      params.credentialGroupId,
      [server.id],
      tx
    )
    const now = new Date()
    await tx
      .update(mcpServers)
      .set({ enabled: false, deletedAt: now, updatedAt: now })
      .where(eq(mcpServers.id, server.id))
    await tx.delete(mcpServerOauth).where(eq(mcpServerOauth.mcpServerId, server.id))
    return {
      mcpServer: toSummary(server),
      serverIds: [server.id],
      retiredMcpConnectionIds,
    }
  })
}
