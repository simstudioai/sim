import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase, ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import {
  mcpServerDelegationPolicy,
  requireMcpCredentialUserId,
} from '@/lib/mcp/application/authorization'
import {
  type McpServerContext,
  type McpWorkspaceContext,
  resolveMcpServerContext,
  resolveMcpWorkspaceContext,
} from '@/lib/mcp/application/context'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  applyMcpServerMutationEffects,
  createMcpServer,
  deleteMcpServer,
  type PerformMcpServerResult,
  updateMcpServer as updateMcpServerRecord,
} from '@/lib/mcp/orchestration'
import {
  getMcpServerIdState,
  listWorkspaceMcpServers,
  type McpServerRow,
  type McpServerSortBy,
} from '@/lib/mcp/queries'
import { mcpService } from '@/lib/mcp/service'
import type { McpAuthType } from '@/lib/mcp/types'
import { generateMcpServerId } from '@/lib/mcp/utils'

type McpServerTransport = McpServerRow['transport']
type McpWriteSource = 'api' | 'settings' | 'tool_input'

function requireSuccessfulResult(
  result: PerformMcpServerResult,
  fallback: string
): PerformMcpServerResult & { server: McpServerRow } {
  if (result.success && result.server)
    return result as PerformMcpServerResult & { server: McpServerRow }
  switch (result.errorCode) {
    case 'not_found':
      throw new OrchestrationError('not_found', 'MCP server not found')
    case 'forbidden':
      /** The single MCP refusal: the URL is off the domain allowlist or resolves internally. */
      throw new ForbiddenOperationError('MCP_SERVER_URL_NOT_ALLOWED', result.error ?? fallback)
    case 'bad_gateway':
      throw new OrchestrationError('validation', result.error ?? fallback)
    case 'conflict':
      throw new OrchestrationError('conflict', result.error ?? fallback)
    default:
      throw new Error(fallback)
  }
}

const authorizationOptions = { delegation: mcpServerDelegationPolicy }

export interface ListMcpServersInput {
  workspaceId: string
  search?: string
  sortBy?: McpServerSortBy
  sortOrder?: ListSortOrder
  /** Absent reads the whole set — only the copilot adapter does that. */
  limit?: number
  cursorKeys?: CursorKey[]
}

/**
 * One page of a workspace's MCP servers, plus the sort the presenter needs to
 * stamp the next cursor with. The surface presenter sees only this result.
 */
export const listMcpServersUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.list,
  resolveContext: ({ input }: { input: ListMcpServersInput }) =>
    resolveMcpWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const page = await listWorkspaceMcpServers({ ...input, workspaceId: context.workspaceId })
    return {
      servers: page.data,
      nextCursorKeys: page.nextCursorKeys,
      sortBy: input.sortBy ?? 'createdAt',
      sortOrder: input.sortOrder ?? 'desc',
    }
  },
})

export interface DiscoverMcpToolsInput {
  workspaceId: string
  refresh?: boolean
}

export const discoverMcpToolsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.discoverTools,
  resolveContext: ({ input }: { input: DiscoverMcpToolsInput }) =>
    resolveMcpWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const tools = await mcpService.discoverTools(
      requireMcpCredentialUserId(principal),
      context.workspaceId,
      /**
       * A public `refresh` skips the positive cache but keeps the failure
       * cooldown; only an explicit user action on their own server may bypass
       * both. See {@link McpDiscoveryRefresh}.
       */
      input.refresh ? 'skip-cache' : 'cache-aside'
    )
    return { tools }
  },
})

export interface DiscoverMcpServerToolsInput {
  workspaceId: string
  serverId: string
  refresh?: boolean
  signal?: AbortSignal
  requireComplete?: boolean
}

/**
 * The tool inventory of one registered MCP server.
 *
 * Shares `mcp_servers.tools.discover` with the workspace-wide discovery: both
 * resolve the acting user's own OAuth credentials against a third-party server,
 * which is why that operation denies workspace API keys. Resolving the server
 * through {@link resolveMcpServerContext} first is what makes an id from another
 * workspace a not-found rather than an upstream connection attempt.
 *
 * The pass is also the only thing that writes the server row's
 * `connectionStatus`, `toolCount`, `lastError`, and `lastToolsRefresh`, so
 * calling this is what makes those fields meaningful on a subsequent read.
 */
export const discoverMcpServerToolsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.discoverTools,
  resolveContext: ({ input }: { input: DiscoverMcpServerToolsInput }) =>
    resolveMcpServerContext(input.workspaceId, input.serverId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    /**
     * `enabled: false` is a documented registration value, but discovery loads
     * its configuration through a query that filters on `enabled`, so a
     * disabled server surfaced as an untyped "not accessible" fault — rendered
     * as a Sim-side 500 — and stamped a bogus failure on the row on the way
     * out. It is a state conflict the caller resolves by enabling the server.
     */
    if (!context.server.enabled) {
      throw new OrchestrationError(
        'conflict',
        'The MCP server is disabled; enable it before listing its tools'
      )
    }
    if (context.server.credentialGroupId) {
      throw new OrchestrationError(
        'conflict',
        'Credential Group MCP servers require an explicit managed connection ID'
      )
    }

    const userId = requireMcpCredentialUserId(principal)
    const refresh = input.refresh ? 'skip-cache' : 'cache-aside'
    const tools =
      input.signal || input.requireComplete
        ? await mcpService.discoverServerTools(
            userId,
            context.server.id,
            context.workspaceId,
            refresh,
            undefined,
            { signal: input.signal, requireComplete: input.requireComplete }
          )
        : await mcpService.discoverServerTools(
            userId,
            context.server.id,
            context.workspaceId,
            refresh
          )
    return { tools }
  },
})

export interface GetMcpServerInput {
  workspaceId: string
  serverId: string
}

export const getMcpServerUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.read,
  resolveContext: ({ input }: { input: GetMcpServerInput }) =>
    resolveMcpServerContext(input.workspaceId, input.serverId),
  authorizationOptions,
  async execute({ context }) {
    return { server: context.server }
  },
})

export interface SaveMcpServerInput {
  workspaceId: string
  name: string
  description?: string | null
  transport?: McpServerTransport
  url: string
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  authType?: McpAuthType
  oauthClientId?: string | null
  oauthClientSecret?: string | null
  source?: McpWriteSource
}

async function saveMcpServer(args: {
  principal: Parameters<typeof resolvePrincipalAttribution>[0]
  input: SaveMcpServerInput
  context: McpWorkspaceContext
  existingServerBehavior?: 'update' | 'reject'
}): Promise<PerformMcpServerResult & { server: McpServerRow }> {
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: args.context.billedAccountUserId,
  })
  const result = await createMcpServer({
    workspaceId: args.context.workspaceId,
    userId: attribution.attributedUserId,
    name: args.input.name,
    description: args.input.description,
    transport: args.input.transport,
    url: args.input.url,
    headers: args.input.headers,
    timeout: args.input.timeout,
    retries: args.input.retries,
    enabled: args.input.enabled,
    authType: args.input.authType,
    oauthClientId: args.input.oauthClientId ?? null,
    oauthClientIdProvided: args.input.oauthClientId !== undefined,
    oauthClientSecret: args.input.oauthClientSecret,
    oauthClientSecretProvided: args.input.oauthClientSecret !== undefined,
    existingServerBehavior: args.existingServerBehavior,
  })
  return requireSuccessfulResult(result, 'Failed to register MCP server')
}

/**
 * A registration is an addition when it inserts a row or revives a soft-deleted
 * one, and an update when it rewrites a live row — which `registerMcpServer`
 * allows, repointing headers and the URL's query string. Auditing only the
 * insert left both upsert outcomes unrecorded.
 */
function createAudit(
  input: SaveMcpServerInput,
  result: PerformMcpServerResult & { server: McpServerRow }
) {
  const isRewrite = result.updated === true && !result.revived
  return [
    {
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
        source: input.source,
        ...(isRewrite ? { updatedFields: result.updatedFields ?? [] } : {}),
      },
    },
  ]
}

export const createMcpServerUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.create,
  resolveContext: ({ input }: { input: SaveMcpServerInput }) =>
    resolveMcpWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const serverId = generateMcpServerId(context.workspaceId, input.url)
    const idState = await getMcpServerIdState({ workspaceId: context.workspaceId, serverId })
    if (idState && !idState.deleted) {
      throw new OrchestrationError(
        'conflict',
        `An MCP server with this URL already exists in this workspace: ${serverId}. Update that server instead of creating a new one.`
      )
    }
    let result: PerformMcpServerResult & { server: McpServerRow }
    try {
      result = await saveMcpServer({
        principal,
        input,
        context,
        existingServerBehavior: 'reject',
      })
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        throw new OrchestrationError(
          'conflict',
          'An MCP server with this URL already exists in this workspace.'
        )
      }
      throw error
    }
    if (result.updated && idState?.deleted !== true) {
      throw new OrchestrationError(
        'conflict',
        'An MCP server with this URL already exists in this workspace.'
      )
    }
    return result
  },
  projectAudit: ({ input, result }) => createAudit(input, result),
  afterSuccess: ({ context, result }) =>
    applyMcpServerMutationEffects({ action: 'create', workspaceId: context.workspaceId, result }),
})

export const registerMcpServerUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.register,
  resolveContext: ({ input }: { input: SaveMcpServerInput }) =>
    resolveMcpWorkspaceContext(input.workspaceId),
  authorizationOptions,
  execute: ({ principal, input, context }) => saveMcpServer({ principal, input, context }),
  projectAudit: ({ input, result }) => createAudit(input, result),
  afterSuccess: ({ context, result }) =>
    applyMcpServerMutationEffects({ action: 'create', workspaceId: context.workspaceId, result }),
})

export interface UpdateMcpServerInput {
  workspaceId: string
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
  oauthClientSecret?: string | null
  source?: McpWriteSource
}

async function updateMcpServer(args: {
  principal: Parameters<typeof resolvePrincipalAttribution>[0]
  input: UpdateMcpServerInput
  context: McpServerContext
}): Promise<PerformMcpServerResult & { server: McpServerRow }> {
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: args.context.billedAccountUserId,
  })
  const result = await updateMcpServerRecord({
    workspaceId: args.context.workspaceId,
    userId: attribution.attributedUserId,
    serverId: args.context.server.id,
    name: args.input.name,
    description: args.input.description,
    transport: args.input.transport,
    url: args.input.url,
    headers: args.input.headers,
    timeout: args.input.timeout,
    retries: args.input.retries,
    enabled: args.input.enabled,
    authType: args.input.authType,
    oauthClientId: args.input.oauthClientId ?? null,
    oauthClientIdProvided: args.input.oauthClientId !== undefined,
    oauthClientSecret: args.input.oauthClientSecret,
    oauthClientSecretProvided: args.input.oauthClientSecret !== undefined,
  })
  return requireSuccessfulResult(result, 'Failed to update MCP server')
}

function updateAudit(
  input: UpdateMcpServerInput,
  result: PerformMcpServerResult & { server: McpServerRow }
) {
  return {
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
      source: input.source,
    },
  }
}

export const updateMcpServerUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.update,
  resolveContext: ({ input }: { input: UpdateMcpServerInput }) =>
    resolveMcpServerContext(input.workspaceId, input.serverId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    if (input.url !== undefined && input.url !== context.server.url) {
      throw new OrchestrationError(
        'validation',
        'url cannot be changed: an MCP server’s id is derived from its URL. Delete this server and create one at the new URL.'
      )
    }
    return updateMcpServer({ principal, input, context })
  },
  projectAudit: ({ input, result }) => updateAudit(input, result),
  afterSuccess: ({ context, result }) =>
    applyMcpServerMutationEffects({ action: 'update', workspaceId: context.workspaceId, result }),
})

export const reconfigureMcpServerUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.reconfigure,
  resolveContext: ({ input }: { input: UpdateMcpServerInput }) =>
    resolveMcpServerContext(input.workspaceId, input.serverId),
  authorizationOptions,
  execute: ({ principal, input, context }) => updateMcpServer({ principal, input, context }),
  projectAudit: ({ input, result }) => updateAudit(input, result),
  afterSuccess: ({ context, result }) =>
    applyMcpServerMutationEffects({ action: 'update', workspaceId: context.workspaceId, result }),
})

export interface DeleteMcpServerInput {
  workspaceId: string
  serverId: string
  source?: McpWriteSource
}

export const deleteMcpServerUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.delete,
  resolveContext: ({ input }: { input: DeleteMcpServerInput }) =>
    resolveMcpServerContext(input.workspaceId, input.serverId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await deleteMcpServer({
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      serverId: context.server.id,
    })
    return requireSuccessfulResult(result, 'Failed to delete MCP server')
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.MCP_SERVER_REMOVED,
    resourceType: AuditResourceType.MCP_SERVER,
    resourceId: result.server.id,
    resourceName: result.server.name,
    description: `Removed MCP server "${result.server.name}"`,
    metadata: {
      serverName: result.server.name,
      transport: result.server.transport,
      url: result.server.url ? sanitizeUrlForLog(result.server.url) : null,
      source: input.source,
    },
  }),
  afterSuccess: ({ context, result }) =>
    applyMcpServerMutationEffects({ action: 'delete', workspaceId: context.workspaceId, result }),
})
