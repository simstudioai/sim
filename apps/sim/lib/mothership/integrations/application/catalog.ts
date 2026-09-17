import {
  type DelegatedPrincipal,
  type OrganizationDelegatedPrincipal,
  type Principal,
  parsePrincipal,
  resolvePrincipalExecutionActorUserId,
  resolvePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createExecutorPrincipalFromExecutionContext,
  resolveExecutorOriginSubject,
} from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { listMcpServersUseCase } from '@/lib/mcp/application/use-cases'
import { parseMcpToolTarget } from '@/lib/mcp/utils'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { buildIntegrationToolSchemas, type ToolSchema } from '@/lib/mothership/chat/payload'
import type {
  IntegrationCatalogRequest,
  IntegrationCatalogResponse,
} from '@/lib/mothership/generated/integration-catalog'
import { buildTaggedMcpToolSchemas } from '@/lib/mothership/mcp-tools'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const INTEGRATION_CATALOG_AUDIENCE = 'sim:integration-catalog'
export const readIntegrationCatalogOperation = defineWorkspaceOperation({
  id: 'mothership.integrations.catalog',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot', 'executor'],
})

/** Return schemas only for targeted discovery, while preserving ranked search and explicit full listings. */
export function projectIntegrationCatalog(
  tools: ToolSchema[],
  input: IntegrationCatalogRequest
): IntegrationCatalogResponse {
  const normalized = input.query?.trim().toLowerCase() ?? ''
  const terms = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  const service = input.service?.trim().toLowerCase()
  const matches = tools.flatMap((tool) => {
    if (input.toolId && tool.name !== input.toolId) return []
    if (service && tool.service?.toLowerCase() !== service) return []
    const name = tool.name.toLowerCase()
    const description = tool.description.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (name.includes(term)) score += 3
      if (description.includes(term)) score += 1
      if (tool.service?.toLowerCase().includes(term)) score += 2
    }
    return terms.length === 0 || score > 0 ? [{ tool, score }] : []
  })
  matches.sort(
    (a, b) =>
      Number(b.tool.name.toLowerCase() === normalized) -
        Number(a.tool.name.toLowerCase() === normalized) ||
      b.score - a.score ||
      a.tool.name.localeCompare(b.tool.name)
  )
  const selected = input.limit === 0 ? matches : matches.slice(0, input.limit)
  return {
    total: matches.length,
    truncated: selected.length < matches.length,
    operations: selected.map(({ tool }) => ({
      toolId: tool.name,
      ...(tool.service ? { service: tool.service } : {}),
      description: tool.description,
      ...(input.toolId || normalized ? { inputSchema: tool.input_schema } : {}),
    })),
  }
}

/** Catalog access rechecks current grants; worker state carries scope and provenance, never schemas. */
const catalogUseCase = defineAuthorizedChatUseCase({
  operation: readIntegrationCatalogOperation,
  organizationOperation: defineOrganizationOperation({
    id: readIntegrationCatalogOperation.id,
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: INTEGRATION_CATALOG_AUDIENCE,
  }),
  async resolveContext({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: IntegrationCatalogRequest
  }) {
    if (principal.kind === 'organization_delegated') {
      if (!('chatId' in principal.resourceScope))
        throw new OrchestrationError('forbidden', 'Integration discovery requires a conversation')
      const context = await resolveOwnedChatContext(principal, principal.resourceScope.chatId)
      if (input.mode !== context.mode)
        throw new OrchestrationError('forbidden', 'Conversation mode mismatch')
      return context
    }
    if (input.workspaceId && input.workspaceId !== principal.workspaceId)
      throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
    const userId = resolvePrincipalExecutionActorUserId(principal)
    if (!userId) throw new OrchestrationError('forbidden', 'Integration discovery requires a user')
    return {
      ...(await resolveActiveWorkspaceApplicationContext(principal.workspaceId)),
      organizationId: undefined,
      userId,
      chatId: principal.resourceScope?.chatId,
      mode: input.mode,
    }
  },
  authorizationOptions: {
    delegation: { audience: INTEGRATION_CATALOG_AUDIENCE, isWithinScope: () => true },
  },
  async execute({ input, context }) {
    const assistant = context.mode === 'assistant'
    if (input.mcpExecution && (assistant || context.organizationId))
      throw new OrchestrationError('forbidden', 'Executor catalogs require workspace agent scope')
    let workspaceId = context.workspaceId
    if (context.organizationId && input.workspaceId) {
      if (assistant)
        throw new OrchestrationError(
          'forbidden',
          'Assistant integration discovery cannot target a workspace'
        )
      workspaceId = (await resolveInvocationWorkspace(context, input.workspaceId)).workspaceId
    }
    const mcpOnly = input.toolId?.startsWith('mcp-') || input.service?.startsWith('mcp:')
    const tools = mcpOnly
      ? []
      : await buildIntegrationToolSchemas(
          context.userId,
          {
            schemaSurface: 'copilot',
            personalAccountsOnly: assistant,
            organizationId: context.organizationId,
          },
          workspaceId
        )
    const includeMcp =
      (!input.toolId || input.toolId.startsWith('mcp-')) &&
      (!input.service || input.service.startsWith('mcp:'))
    if (!assistant && includeMcp && (input.mcpServerIds.length || input.mcpToolIds?.length)) {
      if (!workspaceId) {
        if (input.toolId?.startsWith('mcp-') || input.service?.startsWith('mcp:'))
          throw new OrchestrationError(
            'validation',
            'MCP discovery requires an explicit workspace ID'
          )
        return projectIntegrationCatalog(tools, input)
      }
      const selectedIds = new Set(input.mcpToolIds ?? [])
      const serverIds = new Set(input.mcpServerIds)
      const selectedServers = [...selectedIds].map((id) => {
        const target = parseMcpToolTarget(id)
        return target.kind === 'shared_server' ? target.serverId : target.credentialId
      })
      let candidates = [...new Set([...serverIds, ...selectedServers])].filter(
        (serverId) =>
          (!input.service || input.service === `mcp:${serverId}`) &&
          (!input.toolId || input.toolId.startsWith(`${serverId}-`))
      )
      if (context.organizationId && candidates.length) {
        const { servers } = await listMcpServersUseCase.execute({
          principal: createCopilotChatPrincipal(
            { userId: context.userId, workspaceId },
            MCP_SERVER_DELEGATION_AUDIENCE
          ),
          input: { workspaceId },
        })
        const available = new Set(servers.map((server) => server.id))
        candidates = candidates.filter((id) => available.has(id))
      }
      const executorContext = input.mcpExecution
        ? catalogExecutorContext(input, context.userId, workspaceId)
        : undefined
      const mcpTools = await buildTaggedMcpToolSchemas(
        context.userId,
        workspaceId,
        candidates,
        executorContext
      )
      tools.push(
        ...mcpTools.filter(
          (tool) => selectedIds.has(tool.name) || serverIds.has(tool.service?.slice(4) ?? '')
        )
      )
    }
    return projectIntegrationCatalog(tools, input)
  },
})

/** Restore only the canonical nonsecret origin, never a bearer token from request state. */
function catalogExecutorContext(
  input: IntegrationCatalogRequest,
  userId: string,
  workspaceId: string
): InternalToolOperationContext {
  if (!input.mcpExecution)
    throw new OrchestrationError('forbidden', 'Executor catalog provenance required')
  const { principal: serialized, mcpBlockId, ...origin } = input.mcpExecution
  const executorDelegationOrigin = {
    ...origin,
    ...(serialized !== undefined ? { principal: parsePrincipal(serialized) } : {}),
  }
  const subject = resolveExecutorOriginSubject(executorDelegationOrigin)
  if (subject && subject !== userId)
    throw new OrchestrationError('forbidden', 'Executor catalog subject does not match')
  return {
    userId,
    workspaceId,
    workflowId: origin.currentWorkflow?.workflowId ?? origin.workflowId,
    executionId: origin.executionId,
    mcpBlockId,
    executorDelegationOrigin,
  }
}

/** Rebind verified workflow claims before the shared authorization funnel applies its executor policy. */
async function catalogPrincipal(
  principal: Principal,
  input: IntegrationCatalogRequest
): Promise<Principal> {
  if (!input.mcpExecution) {
    if (principal.kind === 'delegated' && principal.serviceId !== 'copilot')
      throw new OrchestrationError('forbidden', 'Executor catalog provenance required')
    return principal
  }
  if (
    principal.kind !== 'delegated' ||
    principal.serviceId !== 'copilot' ||
    principal.audience !== INTEGRATION_CATALOG_AUDIENCE ||
    principal.expiresAt.getTime() <= Date.now() ||
    input.mode !== 'agent' ||
    (input.workspaceId && input.workspaceId !== principal.workspaceId)
  )
    throw new OrchestrationError('forbidden', 'Invalid executor catalog delegation')
  const userId = resolvePrincipalSubjectUserId(principal)
  if (!userId) throw new OrchestrationError('forbidden', 'Executor catalog actor required')
  const executor = await createExecutorPrincipalFromExecutionContext({
    context: catalogExecutorContext(input, userId, principal.workspaceId),
    audience: INTEGRATION_CATALOG_AUDIENCE,
    expiresAt: principal.expiresAt,
  })
  if (executor.workspaceId !== principal.workspaceId)
    throw new OrchestrationError('not_found', 'Executor catalog workspace does not match')
  return executor
}

export const readIntegrationCatalog: typeof catalogUseCase = {
  operation: readIntegrationCatalogOperation,
  async authorize(args) {
    return catalogUseCase.authorize({
      ...args,
      principal: await catalogPrincipal(args.principal, args.input),
    })
  },
  async execute(args) {
    return catalogUseCase.execute({
      ...args,
      principal: await catalogPrincipal(args.principal, args.input),
    })
  },
}
