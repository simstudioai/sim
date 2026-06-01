import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, mcpServers } from '@sim/db'
import { mcpServerOauth } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  McpDnsResolutionError,
  McpDomainNotAllowedError,
  McpSsrfError,
  validateMcpDomain,
  validateMcpServerSsrf,
} from '@/lib/mcp/domain-check'
import { detectMcpAuthType, oauthCredsChanged, revokeMcpOauthTokens } from '@/lib/mcp/oauth'
import { mcpService } from '@/lib/mcp/service'
import type { McpAuthType } from '@/lib/mcp/types'
import { generateMcpServerId } from '@/lib/mcp/utils'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('McpServerOrchestration')

export type McpServerOrchestrationErrorCode = 'not_found' | 'forbidden' | 'bad_gateway' | 'internal'

type McpServerTransport = (typeof mcpServers.$inferInsert)['transport']

interface ActorMetadata {
  actorName?: string | null
  actorEmail?: string | null
  request?: NextRequest
}

export interface PerformCreateMcpServerParams extends ActorMetadata {
  workspaceId: string
  userId: string
  name: string
  description?: string | null
  transport?: McpServerTransport
  url: string
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  source?: string
  authType?: McpAuthType
  oauthClientId?: string | null
  oauthClientIdProvided?: boolean
  oauthClientSecret?: string | null
  oauthClientSecretProvided?: boolean
}

export interface PerformUpdateMcpServerParams extends ActorMetadata {
  workspaceId: string
  userId: string
  serverId: string
  name?: string
  description?: string | null
  transport?: McpServerTransport
  url?: string
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  authType?: McpAuthType
  oauthClientId?: string | null
  oauthClientIdProvided?: boolean
  oauthClientSecret?: string | null
  oauthClientSecretProvided?: boolean
}

export interface PerformDeleteMcpServerParams extends ActorMetadata {
  workspaceId: string
  userId: string
  serverId: string
  source?: string
}

export interface PerformMcpServerResult {
  success: boolean
  error?: string
  errorCode?: McpServerOrchestrationErrorCode
  serverId?: string
  server?: typeof mcpServers.$inferSelect
  updated?: boolean
  authType?: McpAuthType
}

async function validateMcpServerUrl(url: string): Promise<PerformMcpServerResult | null> {
  try {
    validateMcpDomain(url)
    await validateMcpServerSsrf(url)
    return null
  } catch (error) {
    if (error instanceof McpDomainNotAllowedError || error instanceof McpSsrfError) {
      return { success: false, error: error.message, errorCode: 'forbidden' }
    }
    if (error instanceof McpDnsResolutionError) {
      return { success: false, error: error.message, errorCode: 'bad_gateway' }
    }
    throw error
  }
}

export async function performCreateMcpServer(
  params: PerformCreateMcpServerParams
): Promise<PerformMcpServerResult> {
  const validation = await validateMcpServerUrl(params.url)
  if (validation) return validation

  const transport = params.transport || 'streamable-http'
  const timeout = params.timeout || 30000
  const retries = params.retries || 3
  const enabled = params.enabled !== false
  const serverId = params.url ? generateMcpServerId(params.workspaceId, params.url) : generateId()

  const oauthClientSecretEncrypted = params.oauthClientSecret
    ? (await encryptSecret(params.oauthClientSecret)).encrypted
    : null
  const oauthClientId = params.oauthClientId || null
  const hasHeaders = params.headers && Object.keys(params.headers).length > 0

  try {
    const [existingServer] = await db
      .select({
        id: mcpServers.id,
        deletedAt: mcpServers.deletedAt,
        url: mcpServers.url,
        authType: mcpServers.authType,
        oauthClientId: mcpServers.oauthClientId,
        oauthClientSecret: mcpServers.oauthClientSecret,
      })
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, params.workspaceId)))
      .limit(1)

    const urlChanged = existingServer ? existingServer.url !== params.url : true

    let resolvedAuthType: McpAuthType = params.authType ?? 'headers'
    if (!params.authType) {
      if (existingServer && !urlChanged) {
        resolvedAuthType = (existingServer.authType ?? 'headers') as McpAuthType
      } else if (params.url && !hasHeaders) {
        try {
          resolvedAuthType = await detectMcpAuthType(params.url)
        } catch (e) {
          logger.warn('Probe failed, defaulting to headers', { url: params.url, error: e })
          resolvedAuthType = 'headers'
        }
      }
    }
    if (params.oauthClientId) resolvedAuthType = 'oauth'

    if (existingServer) {
      const credsChanged = await oauthCredsChanged({
        incomingClientId: oauthClientId,
        incomingClientIdProvided: params.oauthClientIdProvided ?? false,
        incomingClientSecret: params.oauthClientSecret,
        incomingClientSecretProvided: params.oauthClientSecretProvided ?? false,
        currentClientId: existingServer.oauthClientId,
        currentEncryptedClientSecret: existingServer.oauthClientSecret,
      })
      const isRevival = existingServer.deletedAt !== null
      const shouldClearOauth = urlChanged || credsChanged || isRevival

      if (shouldClearOauth) await revokeMcpOauthTokens(serverId)

      await db.transaction(async (tx) => {
        if (shouldClearOauth) {
          await tx.delete(mcpServerOauth).where(eq(mcpServerOauth.mcpServerId, serverId))
        }
        const updateValues: Record<string, unknown> = {
          name: params.name,
          description: params.description,
          transport,
          url: params.url,
          authType: resolvedAuthType,
          headers: params.headers || {},
          timeout,
          retries,
          enabled,
          updatedAt: new Date(),
          deletedAt: null,
        }
        if (resolvedAuthType === 'oauth') {
          if (shouldClearOauth) {
            updateValues.connectionStatus = 'disconnected'
            updateValues.lastConnected = null
          }
        } else {
          updateValues.connectionStatus = 'connected'
          updateValues.lastConnected = new Date()
        }
        if (params.oauthClientIdProvided) updateValues.oauthClientId = oauthClientId
        if (params.oauthClientSecretProvided) {
          updateValues.oauthClientSecret = oauthClientSecretEncrypted
        }
        await tx.update(mcpServers).set(updateValues).where(eq(mcpServers.id, serverId))
      })

      await mcpService.clearCache(params.workspaceId)
      return { success: true, serverId, updated: true, authType: resolvedAuthType }
    }

    await db.insert(mcpServers).values({
      id: serverId,
      workspaceId: params.workspaceId,
      createdBy: params.userId,
      name: params.name,
      description: params.description,
      transport,
      url: params.url,
      authType: resolvedAuthType,
      oauthClientId,
      oauthClientSecret: oauthClientSecretEncrypted,
      headers: params.headers || {},
      timeout,
      retries,
      enabled,
      connectionStatus: resolvedAuthType === 'oauth' ? 'disconnected' : 'connected',
      lastConnected: resolvedAuthType === 'oauth' ? null : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await mcpService.clearCache(params.workspaceId)

    try {
      const { PlatformEvents } = await import('@/lib/core/telemetry')
      PlatformEvents.mcpServerAdded({
        serverId,
        serverName: params.name,
        transport,
        workspaceId: params.workspaceId,
      })
    } catch {}

    const source =
      params.source === 'settings' || params.source === 'tool_input' ? params.source : undefined

    captureServerEvent(
      params.userId,
      'mcp_server_connected',
      { workspace_id: params.workspaceId, server_name: params.name, transport, source },
      {
        groups: { workspace: params.workspaceId },
        setOnce: { first_mcp_connected_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_ADDED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: serverId,
      resourceName: params.name,
      description: `Added MCP server "${params.name}"`,
      metadata: {
        serverName: params.name,
        transport,
        url: params.url,
        timeout,
        retries,
        source,
      },
      request: params.request,
    })

    return { success: true, serverId, updated: false, authType: resolvedAuthType }
  } catch (error) {
    logger.error('Failed to create MCP server', { error })
    return { success: false, error: 'Failed to register MCP server', errorCode: 'internal' }
  }
}

export async function performUpdateMcpServer(
  params: PerformUpdateMcpServerParams
): Promise<PerformMcpServerResult> {
  if (params.url) {
    const validation = await validateMcpServerUrl(params.url)
    if (validation) return validation
  }

  const oauthClientSecretEncrypted =
    params.oauthClientSecretProvided && params.oauthClientSecret
      ? (await encryptSecret(params.oauthClientSecret)).encrypted
      : null

  const updateData: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() }
  if (params.name !== undefined) updateData.name = params.name
  if (params.description !== undefined) updateData.description = params.description
  if (params.transport !== undefined) updateData.transport = params.transport
  if (params.url !== undefined) updateData.url = params.url
  if (params.headers !== undefined) updateData.headers = params.headers
  if (params.timeout !== undefined) updateData.timeout = params.timeout
  if (params.retries !== undefined) updateData.retries = params.retries
  if (params.enabled !== undefined) updateData.enabled = params.enabled
  if (params.authType !== undefined) updateData.authType = params.authType
  if (params.oauthClientIdProvided) updateData.oauthClientId = params.oauthClientId || null
  if (params.oauthClientSecretProvided) {
    updateData.oauthClientSecret = oauthClientSecretEncrypted
  }

  try {
    const [currentServer] = await db
      .select({
        url: mcpServers.url,
        authType: mcpServers.authType,
        oauthClientId: mcpServers.oauthClientId,
        oauthClientSecret: mcpServers.oauthClientSecret,
      })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, params.serverId),
          eq(mcpServers.workspaceId, params.workspaceId),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)

    if (!currentServer) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    if (
      params.oauthClientId &&
      currentServer.authType !== 'oauth' &&
      updateData.authType === undefined
    ) {
      updateData.authType = 'oauth'
    }

    const urlChanged = params.url !== undefined && currentServer.url !== params.url
    const credsChanged = await oauthCredsChanged({
      incomingClientId: params.oauthClientId,
      incomingClientIdProvided: params.oauthClientIdProvided ?? false,
      incomingClientSecret: params.oauthClientSecret,
      incomingClientSecretProvided: params.oauthClientSecretProvided ?? false,
      currentClientId: currentServer.oauthClientId,
      currentEncryptedClientSecret: currentServer.oauthClientSecret,
    })
    const shouldClearOauth = urlChanged || credsChanged
    const resolvedAuthType = (updateData.authType ?? currentServer.authType) as McpAuthType
    if (shouldClearOauth && resolvedAuthType === 'oauth') {
      updateData.connectionStatus = 'disconnected'
      updateData.lastConnected = null
    }

    if (shouldClearOauth) await revokeMcpOauthTokens(params.serverId)

    const server = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(mcpServers)
        .set(updateData)
        .where(
          and(
            eq(mcpServers.id, params.serverId),
            eq(mcpServers.workspaceId, params.workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .returning()

      if (!updated) return null

      if (shouldClearOauth) {
        await tx.delete(mcpServerOauth).where(eq(mcpServerOauth.mcpServerId, params.serverId))
      }
      return updated
    })

    if (!server) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    const shouldClearCache =
      urlChanged ||
      credsChanged ||
      params.enabled !== undefined ||
      params.headers !== undefined ||
      params.timeout !== undefined ||
      params.retries !== undefined

    if (shouldClearCache) await mcpService.clearCache(params.workspaceId)

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_UPDATED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      resourceName: server.name || params.serverId,
      description: `Updated MCP server "${server.name || params.serverId}"`,
      metadata: {
        serverName: server.name,
        transport: server.transport,
        url: server.url,
        updatedFields: Object.keys(updateData).filter((key) => key !== 'updatedAt'),
      },
      request: params.request,
    })

    return { success: true, server }
  } catch (error) {
    logger.error('Failed to update MCP server', { error })
    return { success: false, error: 'Failed to update MCP server', errorCode: 'internal' }
  }
}

export async function performDeleteMcpServer(
  params: PerformDeleteMcpServerParams
): Promise<PerformMcpServerResult> {
  try {
    await revokeMcpOauthTokens(params.serverId)
    const [server] = await db
      .delete(mcpServers)
      .where(
        and(eq(mcpServers.id, params.serverId), eq(mcpServers.workspaceId, params.workspaceId))
      )
      .returning()

    if (!server) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    await mcpService.clearCache(params.workspaceId)
    const source =
      params.source === 'settings' || params.source === 'tool_input' ? params.source : undefined

    captureServerEvent(
      params.userId,
      'mcp_server_disconnected',
      { workspace_id: params.workspaceId, server_name: server.name, source },
      { groups: { workspace: params.workspaceId } }
    )

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_REMOVED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: params.serverId,
      resourceName: server.name,
      description: `Removed MCP server "${server.name}"`,
      metadata: {
        serverName: server.name,
        transport: server.transport,
        url: server.url,
        source,
      },
      request: params.request,
    })

    return { success: true, server }
  } catch (error) {
    logger.error('Failed to delete MCP server', { error })
    return { success: false, error: 'Failed to delete MCP server', errorCode: 'internal' }
  }
}
