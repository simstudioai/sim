import { AuditAction, AuditResourceType, auditUpdatedFields, recordAudit } from '@sim/audit'
import { db, mcpServers } from '@sim/db'
import { mcpServerOauth } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
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

export type McpServerOrchestrationErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'bad_gateway'
  | 'conflict'
  | 'internal'

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
  existingServerBehavior?: 'update' | 'reject'
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
  /**
   * Whether an `updated` result brought a soft-deleted row back rather than
   * rewriting a live one. The two need different audit actions: a revival is an
   * addition, a rewrite is an update.
   */
  revived?: boolean
  authType?: McpAuthType
  configurationChanged?: boolean
  /**
   * Fields the update's SET clause wrote, minus `updatedAt`, for audit. Only
   * the writer knows these: a param is not a write, and callers cannot see the
   * `connectionStatus`/`lastConnected`/`lastError` reset that an auth or
   * credential change forces. Record this instead of deriving names from input.
   */
  updatedFields?: string[]
}

export type McpServerMutationAction = 'create' | 'update' | 'delete'

type ValidateMcpServerUrlResult =
  | { ok: true; resolvedIP: string | null }
  | { ok: false; result: PerformMcpServerResult }

async function validateMcpServerUrl(url: string): Promise<ValidateMcpServerUrlResult> {
  try {
    validateMcpDomain(url)
    const resolvedIP = await validateMcpServerSsrf(url)
    return { ok: true, resolvedIP }
  } catch (error) {
    if (error instanceof McpDomainNotAllowedError || error instanceof McpSsrfError) {
      return { ok: false, result: { success: false, error: error.message, errorCode: 'forbidden' } }
    }
    if (error instanceof McpDnsResolutionError) {
      return {
        ok: false,
        result: { success: false, error: error.message, errorCode: 'bad_gateway' },
      }
    }
    throw error
  }
}

export async function createMcpServer(
  params: Omit<PerformCreateMcpServerParams, keyof ActorMetadata | 'source'>
): Promise<PerformMcpServerResult> {
  const validation = await validateMcpServerUrl(params.url)
  if (!validation.ok) return validation.result
  const validatedIP = validation.resolvedIP

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

    if (
      existingServer &&
      existingServer.deletedAt === null &&
      params.existingServerBehavior === 'reject'
    ) {
      return {
        success: false,
        error: 'An MCP server with this URL already exists in this workspace',
        errorCode: 'conflict',
      }
    }

    let resolvedAuthType: McpAuthType = params.authType ?? 'headers'
    if (!params.authType) {
      if (existingServer && !urlChanged) {
        resolvedAuthType = (existingServer.authType ?? 'headers') as McpAuthType
      } else if (params.url && !hasHeaders) {
        try {
          resolvedAuthType = await detectMcpAuthType(params.url, validatedIP)
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
      const authTypeChanged = existingServer.authType !== resolvedAuthType
      // Turning OAuth off orphans its tokens; revoke and delete them, mirroring the update path.
      const oauthDisabled = existingServer.authType === 'oauth' && resolvedAuthType !== 'oauth'
      const shouldClearOauth = urlChanged || credsChanged || isRevival || oauthDisabled

      if (shouldClearOauth) await revokeMcpOauthTokens(serverId, params.workspaceId)

      let updatedFields: string[] = []
      await db.transaction(async (tx) => {
        if (shouldClearOauth) {
          await tx.delete(mcpServerOauth).where(eq(mcpServerOauth.mcpServerId, serverId))
        }
        const updateValues: Partial<typeof mcpServers.$inferInsert> = {
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
        if (authTypeChanged || (shouldClearOauth && resolvedAuthType === 'oauth')) {
          // An auth-type flip, or an OAuth URL/creds change, invalidates any prior connection:
          // reset to disconnected and clear the stale error so the UI never shows
          // connected-with-error until re-discovery. Mirrors performUpdateMcpServer.
          updateValues.connectionStatus = 'disconnected'
          updateValues.lastConnected = null
          updateValues.lastError = null
        } else if (resolvedAuthType !== 'oauth') {
          // A non-OAuth (re-)registration with unchanged auth optimistically marks the server
          // reachable; discovery corrects it if the endpoint is unhealthy.
          updateValues.connectionStatus = 'connected'
          updateValues.lastConnected = new Date()
        }
        if (params.oauthClientIdProvided) updateValues.oauthClientId = oauthClientId
        if (params.oauthClientSecretProvided) {
          updateValues.oauthClientSecret = oauthClientSecretEncrypted
        }
        /**
         * Drizzle skips `undefined` in `.set()`, and this object assigns every
         * column unconditionally — `description` is present but undefined when
         * the registration omits it. Keys must therefore be filtered by value,
         * or the audit claims a column the write never touched. `null` stays:
         * clearing a value is a write.
         */
        updatedFields = Object.entries(updateValues)
          .filter(([key, value]) => key !== 'updatedAt' && value !== undefined)
          .map(([key]) => key)
        await tx.update(mcpServers).set(updateValues).where(eq(mcpServers.id, serverId))
      })

      const [server] = await db
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, params.workspaceId)))
        .limit(1)
      if (!server) throw new Error(`MCP server ${serverId} missing after a successful update`)
      return {
        success: true,
        serverId,
        server,
        updated: true,
        revived: isRevival,
        updatedFields,
        authType: resolvedAuthType,
      }
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

    const [server] = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, params.workspaceId)))
      .limit(1)
    if (!server) throw new Error(`MCP server ${serverId} missing after a successful insert`)
    return { success: true, serverId, server, updated: false, authType: resolvedAuthType }
  } catch (error) {
    logger.error('Failed to create MCP server', { error })
    throw error
  }
}

export async function updateMcpServer(
  params: Omit<PerformUpdateMcpServerParams, keyof ActorMetadata>
): Promise<PerformMcpServerResult> {
  if (params.url) {
    const validation = await validateMcpServerUrl(params.url)
    if (!validation.ok) return validation.result
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
    const resolvedAuthType = (updateData.authType ?? currentServer.authType) as McpAuthType
    const authTypeChanged = resolvedAuthType !== currentServer.authType
    // Turning OAuth off must revoke and delete its now-orphaned tokens, not just reset the connection.
    const oauthDisabled = currentServer.authType === 'oauth' && resolvedAuthType !== 'oauth'
    const shouldClearOauth = urlChanged || credsChanged || oauthDisabled
    // An auth-type flip (either direction) or OAuth creds/URL change invalidates the connection: reset and clear stale state.
    if (authTypeChanged || (shouldClearOauth && resolvedAuthType === 'oauth')) {
      updateData.connectionStatus = 'disconnected'
      updateData.lastConnected = null
      updateData.lastError = null
    }

    if (shouldClearOauth) await revokeMcpOauthTokens(params.serverId, params.workspaceId)

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
      params.transport !== undefined ||
      authTypeChanged ||
      params.enabled !== undefined ||
      params.headers !== undefined ||
      params.timeout !== undefined ||
      params.retries !== undefined

    return {
      success: true,
      server,
      configurationChanged: shouldClearCache,
      updatedFields: auditUpdatedFields(updateData),
    }
  } catch (error) {
    logger.error('Failed to update MCP server', { error })
    throw error
  }
}

export async function deleteMcpServer(
  params: Omit<PerformDeleteMcpServerParams, keyof ActorMetadata | 'source'>
): Promise<PerformMcpServerResult> {
  try {
    await revokeMcpOauthTokens(params.serverId, params.workspaceId)
    const [server] = await db
      .delete(mcpServers)
      .where(
        and(eq(mcpServers.id, params.serverId), eq(mcpServers.workspaceId, params.workspaceId))
      )
      .returning()

    if (!server) return { success: false, error: 'Server not found', errorCode: 'not_found' }

    return { success: true, server }
  } catch (error) {
    logger.error('Failed to delete MCP server', { error })
    throw error
  }
}

function legacySource(source: string | undefined): 'settings' | 'tool_input' | undefined {
  return source === 'settings' || source === 'tool_input' ? source : undefined
}

/** Preserves the legacy internal registration result, analytics, audit, and effects contract. */
export async function performCreateMcpServer(
  params: PerformCreateMcpServerParams
): Promise<PerformMcpServerResult> {
  try {
    const result = await createMcpServer(params)
    if (!result.success) return result
    if (!result.server) throw new Error('Successful MCP registration is missing its server')

    await applyMcpServerMutationEffects({
      action: 'create',
      workspaceId: params.workspaceId,
      result,
    })
    const source = legacySource(params.source)
    if (!result.updated) {
      captureServerEvent(
        params.userId,
        'mcp_server_connected',
        {
          workspace_id: params.workspaceId,
          server_name: result.server.name,
          transport: result.server.transport,
          source,
        },
        {
          groups: { workspace: params.workspaceId },
          setOnce: { first_mcp_connected_at: new Date().toISOString() },
        }
      )
    }

    /**
     * Registering a URL that already exists rewrites the live row — headers, the
     * URL's query string, transport, enabled — so it is an update, not an
     * addition. Reviving a soft-deleted row is still an addition. Auditing only
     * the insert left both cases with no trace at all.
     */
    const isRewrite = result.updated === true && !result.revived
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: isRewrite ? AuditAction.MCP_SERVER_UPDATED : AuditAction.MCP_SERVER_ADDED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: result.server.id,
      resourceName: result.server.name,
      description: `${isRewrite ? 'Updated' : 'Added'} MCP server "${result.server.name}"`,
      metadata: {
        serverName: result.server.name,
        transport: result.server.transport,
        url: result.server.url ? sanitizeUrlForLog(result.server.url) : null,
        timeout: result.server.timeout,
        retries: result.server.retries,
        source,
        ...(isRewrite ? { updatedFields: result.updatedFields ?? [] } : {}),
      },
      request: params.request,
    })
    return result
  } catch (error) {
    logger.error('Failed to register MCP server', { error })
    return { success: false, error: 'Failed to register MCP server', errorCode: 'internal' }
  }
}

/** Preserves the legacy internal update result, audit, and effects contract. */
export async function performUpdateMcpServer(
  params: PerformUpdateMcpServerParams
): Promise<PerformMcpServerResult> {
  try {
    const result = await updateMcpServer(params)
    if (!result.success || !result.server) return result

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_UPDATED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: result.server.id,
      resourceName: result.server.name,
      description: `Updated MCP server "${result.server.name}"`,
      metadata: {
        serverName: result.server.name,
        transport: result.server.transport,
        url: result.server.url ? sanitizeUrlForLog(result.server.url) : null,
        updatedFields: result.updatedFields ?? [],
      },
      request: params.request,
    })
    await applyMcpServerMutationEffects({
      action: 'update',
      workspaceId: params.workspaceId,
      result,
    })
    return result
  } catch (error) {
    logger.error('Failed to update MCP server', { error })
    return { success: false, error: 'Failed to update MCP server', errorCode: 'internal' }
  }
}

/** Preserves the legacy internal delete result, analytics, audit, and effects contract. */
export async function performDeleteMcpServer(
  params: PerformDeleteMcpServerParams
): Promise<PerformMcpServerResult> {
  try {
    const result = await deleteMcpServer(params)
    if (!result.success || !result.server) return result

    const source = legacySource(params.source)
    captureServerEvent(
      params.userId,
      'mcp_server_disconnected',
      {
        workspace_id: params.workspaceId,
        server_name: result.server.name,
        source,
      },
      { groups: { workspace: params.workspaceId } }
    )
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.MCP_SERVER_REMOVED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: result.server.id,
      resourceName: result.server.name,
      description: `Removed MCP server "${result.server.name}"`,
      metadata: {
        serverName: result.server.name,
        transport: result.server.transport,
        url: result.server.url ? sanitizeUrlForLog(result.server.url) : null,
        source,
      },
      request: params.request,
    })
    await applyMcpServerMutationEffects({
      action: 'delete',
      workspaceId: params.workspaceId,
      result,
    })
    return result
  } catch (error) {
    logger.error('Failed to delete MCP server', { error })
    return { success: false, error: 'Failed to delete MCP server', errorCode: 'internal' }
  }
}

/** Applies shared cache, connection, and domain-telemetry effects after semantic audit. */
export async function applyMcpServerMutationEffects(params: {
  action: McpServerMutationAction
  workspaceId: string
  result: PerformMcpServerResult
}): Promise<void> {
  const { action, workspaceId, result } = params
  if (!result.serverId && !result.server?.id) {
    throw new Error(`MCP ${action} result is missing its server ID`)
  }
  const serverId = result.serverId ?? result.server!.id

  if (action === 'update' && !result.configurationChanged) return
  await mcpService.clearCache(workspaceId)
  if (action !== 'create' || result.updated) {
    await mcpService.evictServerConnections(
      serverId,
      action === 'delete' ? 'server deleted' : 'config changed'
    )
  }

  if (action === 'create' && result.updated === false && result.server) {
    const { PlatformEvents } = await import('@/lib/core/telemetry')
    PlatformEvents.mcpServerAdded({
      serverId,
      serverName: result.server.name,
      transport: result.server.transport,
      workspaceId,
    })
  }
}
