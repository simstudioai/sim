import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId, resolvePrincipalAttribution } from '@sim/auth/principal'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import { mcpServerDelegationPolicy } from '@/lib/mcp/application/authorization'
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
  getWorkspaceMcpServer,
  listWorkspaceMcpServers,
  type McpServerRow,
  type McpServerSortBy,
} from '@/lib/mcp/queries'
import { mcpService } from '@/lib/mcp/service'
import type { McpAuthType } from '@/lib/mcp/types'
import { generateMcpServerId } from '@/lib/mcp/utils'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'

type McpServerTransport = McpServerRow['transport']
type McpWriteSource = 'api' | 'settings' | 'tool_input'

interface McpWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

interface McpServerContext extends McpWorkspaceContext {
  server: McpServerRow
}

async function resolveWorkspaceContext(workspaceId: string): Promise<McpWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveServerContext(
  workspaceId: string,
  serverId: string
): Promise<McpServerContext> {
  const workspace = await resolveWorkspaceContext(workspaceId)
  const server = await getWorkspaceMcpServer({ workspaceId: workspace.workspaceId, serverId })
  if (!server) throw new OrchestrationError('not_found', 'MCP server not found')
  return { ...workspace, server }
}

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
      throw new OrchestrationError('forbidden', result.error ?? fallback)
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
}

export const listMcpServersUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.list,
  resolveContext: ({ input }: { input: ListMcpServersInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const servers = await listWorkspaceMcpServers({ ...input, workspaceId: context.workspaceId })
    return { servers }
  },
})

export interface DiscoverMcpToolsInput {
  workspaceId: string
  refresh?: boolean
}

export const discoverMcpToolsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: mcpServerOperations.discoverTools,
  resolveContext: ({ input }: { input: DiscoverMcpToolsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const tools = await mcpService.discoverTools(
      requirePrincipalSubjectUserId(principal),
      context.workspaceId,
      input.refresh ?? false
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
    resolveServerContext(input.workspaceId, input.serverId),
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
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const serverId = generateMcpServerId(context.workspaceId, input.url)
    const idState = await getMcpServerIdState({ workspaceId: context.workspaceId, serverId })
    if (idState && !idState.deleted) {
      throw new OrchestrationError(
        'conflict',
        'An MCP server with this URL already exists in this workspace. Update it with PATCH /api/v2/mcp-servers/{id}.'
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
    resolveWorkspaceContext(input.workspaceId),
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
    resolveServerContext(input.workspaceId, input.serverId),
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
    resolveServerContext(input.workspaceId, input.serverId),
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
    resolveServerContext(input.workspaceId, input.serverId),
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
