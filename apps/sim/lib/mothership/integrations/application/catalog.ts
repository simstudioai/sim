import {
  type DelegatedPrincipal,
  type OrganizationDelegatedPrincipal,
  type Principal,
  parsePrincipal,
  resolvePrincipalExecutionActorUserId,
  resolvePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { stripVersionSuffix } from '@sim/utils/string'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getAccessibleOAuthCredentials,
  getEnrolledManagedOAuthCredentials,
} from '@/lib/credentials/environment'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { getIntegrationsForCredentialProvider } from '@/lib/integrations/credential-display'
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
import { isSearchIntegrationToolsEnabled } from '@/lib/mothership/feature-flags'
import type {
  IntegrationCatalogRequest,
  IntegrationCatalogResponse,
} from '@/lib/mothership/generated/integration-catalog'
import { buildMcpToolSchemas } from '@/lib/mothership/mcp-tools'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import {
  assertPermissionsAllowed,
  McpToolsNotAllowedError,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('IntegrationCatalog')

export const INTEGRATION_CATALOG_AUDIENCE = 'sim:integration-catalog'
export const readIntegrationCatalogOperation = defineWorkspaceOperation({
  id: 'mothership.integrations.catalog',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  contentDelivery: 'none',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot', 'executor'],
})

/**
 * Filler in a natural-language intent ("send an email to a customer"). Left in, these
 * match nearly every operation description and bury the words that name the operation.
 */
const STOP_WORDS: ReadonlySet<string> = new Set(
  'a about all am an and any are as at be by can do does for from get how i in into is it its me my of on or our please so some that the their them then this to use using via want we what when where which who why will with you your'.split(
    ' '
  )
)
const MIN_TERM_LENGTH = 2
/** Standard Okapi BM25 saturation and length normalization. */
const BM25_K1 = 1.2
const BM25_B = 0.75
/**
 * An operation the requester can already authenticate is the likelier intent ("send an
 * email" with Gmail connected): its score is multiplied by this, so it beats an unconnected
 * match up to a third stronger, but not one well beyond that.
 */
const CONNECTED_SERVICE_BOOST = 1.5

/** Folds a plural onto its singular: "emails" → "email", "entries" → "entry", "searches" → "search". */
function singular(term: string): string {
  if (term.length > 4 && term.endsWith('ies')) return `${term.slice(0, -3)}y`
  // A consonant before -uses (statuses, buses); warehouses and houses keep their e.
  if (term.length > 4 && /(ss|sh|ch|x|z|[^aeiou]us)es$/.test(term)) return term.slice(0, -2)
  if (term.length > 3 && term.endsWith('s') && !/(ss|us|is)$/.test(term)) return term.slice(0, -1)
  return term
}

/** Parameter names stay whole (`customerEmail`), so a field list never outweighs the name. */
function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      // Before folding too: "does" would fold to "doe", which no stop list names.
      .filter((term) => !STOP_WORDS.has(term))
      .map(singular)
      .filter((term) => term.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(term))
  )
}

/** Name, service, description and parameter names: everything an intent may echo. */
function operationTerms(tool: ToolSchema): string[] {
  const properties = tool.input_schema.properties
  const parameters =
    properties && typeof properties === 'object' ? Object.keys(properties).join(' ') : ''
  return tokenize(`${tool.name} ${tool.service ?? ''} ${tool.description} ${parameters}`)
}

interface OperationTermStats {
  length: number
  frequencies: ReadonlyMap<string, number>
}

/**
 * Integration schemas are shared, frozen objects reused across requests, so their terms
 * are counted once per process; per-request MCP schemas fall out with their request.
 */
const operationTermStats = new WeakMap<ToolSchema, OperationTermStats>()

function getOperationTermStats(tool: ToolSchema): OperationTermStats {
  const cached = operationTermStats.get(tool)
  if (cached) return cached
  const terms = operationTerms(tool)
  const frequencies = new Map<string, number>()
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
  const stats = { length: terms.length, frequencies }
  operationTermStats.set(tool, stats)
  return stats
}

/** Okapi BM25 over the candidate operations; zero means no query term occurs. */
function rankByBm25(tools: ToolSchema[], queryTerms: string[]): number[] {
  const query = new Set(queryTerms)
  const documents = tools.map((tool) => {
    const stats = getOperationTermStats(tool)
    const frequencies = new Map<string, number>()
    for (const term of query) {
      const frequency = stats.frequencies.get(term)
      if (frequency) frequencies.set(term, frequency)
    }
    return { length: stats.length, frequencies }
  })
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) / (documents.length || 1)
  const inverseFrequency = new Map(
    [...query].map((term) => {
      const containing = documents.filter((document) => document.frequencies.has(term)).length
      return [
        term,
        Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5)),
      ] as const
    })
  )
  return documents.map((document) => {
    const normalization = 1 - BM25_B + (BM25_B * document.length) / (averageLength || 1)
    let score = 0
    for (const [term, frequency] of document.frequencies)
      score +=
        ((inverseFrequency.get(term) ?? 0) * frequency * (BM25_K1 + 1)) /
        (frequency + BM25_K1 * normalization)
    return score
  })
}

/** Services any of these connected credential providers can authenticate, as catalog service IDs. */
function resolveConnectedServices(
  tools: ToolSchema[],
  providerIds: readonly string[]
): ReadonlySet<string> {
  const services = new Set<string>()
  for (const providerId of providerIds) {
    for (const integration of getIntegrationsForCredentialProvider(providerId))
      services.add(stripVersionSuffix(integration.type).toLowerCase())
    for (const tool of tools)
      if (tool.service && tool.oauth?.provider === providerId)
        services.add(tool.service.toLowerCase())
  }
  return services
}

interface CatalogProjectionOptions {
  /** Services the user named in the conversation; they rank first among equally relevant matches. */
  preferredServices?: ReadonlySet<string>
  /** Credential providers the requester has connected; their services' scores are boosted. */
  connectedProviderIds?: readonly string[]
}

/**
 * Return schemas only for targeted discovery (query, service or exact ID), while keeping
 * explicit full listings compact. Free-text queries rank by BM25, with operations of the
 * requester's connected services boosted; an exact operation ID always ranks first, and
 * preferred services break ties in score. A query with no content terms ("what can I
 * use", or a script the tokenizer does not split) asks for the listing, as an empty one does.
 */
export function projectIntegrationCatalog(
  tools: ToolSchema[],
  input: IntegrationCatalogRequest,
  { preferredServices, connectedProviderIds = [] }: CatalogProjectionOptions = {}
): IntegrationCatalogResponse {
  const preferred = (tool: ToolSchema) =>
    Number(Boolean(tool.service && preferredServices?.has(tool.service)))
  const normalized = input.query?.trim().toLowerCase() ?? ''
  const queryTerms = tokenize(input.query ?? '')
  const services = resolveServiceFilter(tools, input.service)
  const candidates = tools.filter(
    (tool) =>
      (!input.toolId || tool.name === input.toolId) &&
      (!services || (tool.service && services.has(tool.service.toLowerCase())))
  )
  const ranked = queryTerms.length > 0
  const connected = ranked ? resolveConnectedServices(candidates, connectedProviderIds) : null
  const scores = ranked ? rankByBm25(candidates, queryTerms) : []
  const matches = candidates.flatMap((tool, index) => {
    const exact = Boolean(normalized) && tool.name.toLowerCase() === normalized
    if (!ranked) return [{ tool, exact, score: 0 }]
    const score =
      (scores[index] ?? 0) *
      (tool.service && connected?.has(tool.service.toLowerCase()) ? CONNECTED_SERVICE_BOOST : 1)
    return exact || score > 0 ? [{ tool, exact, score }] : []
  })
  matches.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.score - a.score ||
      preferred(b.tool) - preferred(a.tool) ||
      a.tool.name.localeCompare(b.tool.name)
  )
  const selected = input.limit === 0 ? matches : matches.slice(0, input.limit)
  const targeted = Boolean(input.toolId || ranked || services)
  return {
    total: matches.length,
    truncated: selected.length < matches.length,
    operations: selected.map(({ tool }) => ({
      toolId: tool.name,
      ...(tool.service ? { service: tool.service } : {}),
      description: tool.description,
      ...(targeted ? { inputSchema: tool.input_schema } : {}),
    })),
  }
}

/** Specific service identities win over credential families; resolution never adds callable tools. */
function resolveServiceFilter(
  tools: ToolSchema[],
  service: string | undefined
): ReadonlySet<string> | undefined {
  const normalized = service?.trim().toLowerCase()
  if (!normalized) return undefined
  if (
    normalized.startsWith('mcp:') ||
    tools.some((tool) => tool.service?.toLowerCase() === normalized)
  ) {
    return new Set([normalized])
  }

  const named = INTEGRATION_METADATA.filter((integration) =>
    [
      integration.type,
      stripVersionSuffix(integration.type),
      integration.slug,
      integration.name,
    ].some((name) => name.toLowerCase() === normalized)
  )
  const integrations = named.length ? named : getIntegrationsForCredentialProvider(normalized)
  const services = new Set(
    integrations.map((integration) => stripVersionSuffix(integration.type).toLowerCase())
  )
  /** Callable preview integrations may not yet appear in the public metadata. */
  if (!named.length) {
    for (const tool of tools) {
      if (tool.service && tool.oauth?.provider.toLowerCase() === normalized) {
        services.add(tool.service.toLowerCase())
      }
    }
  }
  if (services.size) return services
  throw new OrchestrationError(
    'validation',
    'Unknown integration service. Use a service ID, name, or credential provider from discovery, or retry without the service filter.'
  )
}

/** Catalog access rechecks current grants; worker state carries scope and provenance, never schemas. */
const catalogUseCase = defineAuthorizedChatUseCase({
  operation: readIntegrationCatalogOperation,
  organizationOperation: defineOrganizationOperation({
    id: readIntegrationCatalogOperation.id,
    contentDelivery: 'none',
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
    if (context.mode === 'assistant' && !(await isSearchIntegrationToolsEnabled()))
      return { total: 0, truncated: false, operations: [] }
    if (input.mcpExecution && context.organizationId)
      throw new OrchestrationError('forbidden', 'Executor catalogs require workspace agent scope')
    let workspaceId = context.workspaceId
    if (context.organizationId && input.workspaceId) {
      workspaceId = (await resolveInvocationWorkspace(context, input.workspaceId)).workspaceId
    }
    const mcpOnly = input.toolId?.startsWith('mcp-') || input.service?.startsWith('mcp:')
    const [tools, connectedProviderIds]: [ToolSchema[], string[]] = await Promise.all([
      mcpOnly
        ? []
        : buildIntegrationToolSchemas(
            context.userId,
            {
              schemaSurface: 'copilot',
              organizationId: context.organizationId,
              ...(context.mode === 'assistant' ? { personalAccountsOnly: true } : {}),
            },
            workspaceId
          ),
      mcpOnly || input.toolId || !input.query?.trim()
        ? []
        : listConnectedProviderIds(context.userId, workspaceId, context.organizationId),
    ])
    const includeMcp =
      context.mode !== 'assistant' &&
      (!input.toolId || input.toolId.startsWith('mcp-')) &&
      (!input.service || input.service.startsWith('mcp:'))
    /** A workflow block's request names its operations; a chat may use every usable server. */
    const selectionScoped = Boolean(input.mcpExecution || input.mcpToolIds?.length)
    const selectsNothing = !input.mcpServerIds.length && !input.mcpToolIds?.length
    if (!includeMcp || (selectionScoped && selectsNothing))
      return projectIntegrationCatalog(tools, input, { connectedProviderIds })
    const targeted = Boolean(input.toolId?.startsWith('mcp-') || input.service?.startsWith('mcp:'))
    if (!workspaceId) {
      if (targeted)
        throw new OrchestrationError(
          'validation',
          'MCP discovery requires an explicit workspace ID'
        )
      return projectIntegrationCatalog(tools, input, { connectedProviderIds })
    }
    try {
      await assertPermissionsAllowed({ userId: context.userId, workspaceId, toolKind: 'mcp' })
    } catch (error) {
      if (selectionScoped || targeted || !(error instanceof McpToolsNotAllowedError)) throw error
      return projectIntegrationCatalog(tools, input, { connectedProviderIds })
    }

    const selectedIds = new Set(input.mcpToolIds ?? [])
    const taggedIds = new Set(input.mcpServerIds)
    const isTarget = (serverId: string) =>
      (!input.service || input.service === `mcp:${serverId}`) &&
      (!input.toolId || input.toolId.startsWith(`${serverId}-`))
    const selectedServers = [...selectedIds].map((id) => {
      const target = parseMcpToolTarget(id)
      return target.kind === 'shared_server' ? target.serverId : target.credentialId
    })
    const named = [...new Set([...taggedIds, ...selectedServers])].filter(isTarget)
    let complete = named
    let bestEffort: string[] = []
    if (!selectionScoped) {
      /** Broad discovery is optional: without the server list it keeps the tagged servers and built-ins. */
      const usable = await listUsableMcpServerIds(context.userId, workspaceId).catch(
        (error: unknown) => {
          if (targeted) throw error
          logger.warn('Workspace MCP servers unavailable; discovering only tagged servers', {
            workspaceId,
            error: getErrorMessage(error),
          })
          return null
        }
      )
      const untagged = [...(usable ?? [])].filter(
        (serverId) => isTarget(serverId) && !taggedIds.has(serverId)
      )
      /** A targeted server is listed completely; a tagged one keeps its own error even once unusable. */
      if (targeted) complete = [...named, ...untagged]
      else if (usable) {
        complete = named.filter((serverId) => usable.has(serverId))
        for (const serverId of named)
          if (!usable.has(serverId))
            logger.warn(
              'Omitting a tagged MCP server that is no longer usable from the integration catalog',
              {
                serverId,
              }
            )
        bestEffort = untagged
      }
    }
    const executorContext = input.mcpExecution
      ? catalogExecutorContext(input, context.userId, workspaceId)
      : undefined
    const { tools: mcpTools, failures } = await buildMcpToolSchemas(
      context.userId,
      workspaceId,
      { complete, bestEffort },
      executorContext
    )
    const targetFailure = failures.find(
      ({ serverId }) =>
        input.service === `mcp:${serverId}` ||
        (input.toolId?.startsWith(`${serverId}-`) &&
          !mcpTools.some((tool) => tool.name === input.toolId))
    )
    if (targetFailure) throw targetFailure.error
    for (const { serverId, error } of failures) {
      const details = { serverId, reason: error.message }
      if (taggedIds.has(serverId) || selectedServers.includes(serverId))
        logger.warn(
          'Omitting an undiscoverable tagged MCP server from the integration catalog',
          details
        )
      else
        logger.info('Omitting an undiscoverable MCP server from the integration catalog', details)
    }
    tools.push(
      ...(selectionScoped
        ? mcpTools.filter(
            (tool) => selectedIds.has(tool.name) || taggedIds.has(tool.service?.slice(4) ?? '')
          )
        : mcpTools)
    )
    return projectIntegrationCatalog(tools, input, {
      connectedProviderIds,
      preferredServices: new Set([...taggedIds].map((serverId) => `mcp:${serverId}`)),
    })
  },
})

/**
 * The enabled, live servers in the workspace that the requester may use through
 * chat. Credential Group servers need an explicit managed connection, so only a
 * workflow block's selection reaches them.
 */
async function listUsableMcpServerIds(userId: string, workspaceId: string): Promise<Set<string>> {
  const { servers } = await listMcpServersUseCase.execute({
    principal: createCopilotChatPrincipal({ userId, workspaceId }, MCP_SERVER_DELEGATION_AUDIENCE),
    input: { workspaceId },
  })
  return new Set(
    servers
      .filter((server) => server.enabled && !server.credentialGroupId)
      .map((server) => server.id)
  )
}

/**
 * Credential providers the requester can use in this scope, a ranking hint only: the tool
 * list is already authorized, and a connected service never adds or reveals an operation.
 */
async function listConnectedProviderIds(
  userId: string,
  workspaceId: string | undefined,
  organizationId: string | undefined
): Promise<string[]> {
  try {
    const credentials = workspaceId
      ? (
          await Promise.all([
            getAccessibleOAuthCredentials(workspaceId, userId),
            getEnrolledManagedOAuthCredentials(workspaceId, userId),
          ])
        ).flat()
      : organizationId
        ? await getOwnOrganizationManagedOAuthCredentials({ organizationId, userId })
        : []
    return credentials.map((credential) => credential.providerId)
  } catch (error) {
    // Only ranking depends on it, so discovery proceeds unboosted.
    logger.warn('Connected services unavailable for integration ranking', {
      error: getErrorMessage(error),
    })
    return []
  }
}

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
