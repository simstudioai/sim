import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { mapSettledWithConcurrency } from '@/lib/core/utils/concurrency'
import { DeadlineExceededError, withinDeadline } from '@/lib/core/utils/deadline'
import { discoverMcpServerToolsAsExecutor } from '@/lib/internal/mcp/discover-tools'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import type { McpToolSchema } from '@/lib/mcp/types'
import { createMcpToolId } from '@/lib/mcp/utils'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import type { ToolSchema } from '@/lib/mothership/chat/payload'

/**
 * How long a catalog query waits on one best-effort server, counted from that
 * server's own start. A warm server is a cache read; a cold or slow one is
 * skipped for this query while its discovery keeps running and fills the cache
 * for the next one.
 */
const BEST_EFFORT_DISCOVERY_WAIT_MS = 3_000
/**
 * Best-effort discoveries a query runs at once. The wait does not cancel a
 * discovery, so this also caps the connections one query can leave running.
 */
const BEST_EFFORT_DISCOVERY_CONCURRENCY = 8
/**
 * How long after a query begins it may still start a best-effort discovery.
 * Servers still queued then are skipped for this query, so with the wait it
 * bounds the query's latency at about six seconds however many servers the
 * workspace has.
 */
const BEST_EFFORT_DISCOVERY_START_WINDOW_MS = 3_000
/** How long a requester skips a best-effort server whose discovery failed or outlived the wait. */
const BEST_EFFORT_RETRY_AFTER_MS = 60_000
const MAX_RECENT_BEST_EFFORT_FAILURES = 1_000

/** One attempt's failure; the entry's identity is that attempt's, so a later attempt's entry is never its to settle. */
interface BestEffortFailure {
  error: Error
}

/**
 * Best-effort servers that recently failed for a requester, keyed by
 * `workspaceId:serverId:userId`. It lives in this process because best-effort
 * discovery must leave the server's shared status and cooldown to the
 * discoveries someone asked for.
 */
const recentBestEffortFailures = new LRUCache<string, BestEffortFailure>({
  max: MAX_RECENT_BEST_EFFORT_FAILURES,
  ttl: BEST_EFFORT_RETRY_AFTER_MS,
})

interface McpServerDiscoveryFailure {
  serverId: string
  error: Error
}

interface McpDiscovery {
  tools: ToolSchema[]
  /** Servers that could not be discovered in time or listed no permitted operations. */
  failures: McpServerDiscoveryFailure[]
}

interface McpDiscoveryServers {
  /** Servers the request names: listed live and completely, however long that takes. */
  complete: string[]
  /**
   * Chat-only: servers available without being named. At most
   * {@link BEST_EFFORT_DISCOVERY_CONCURRENCY} are discovered at once, each served
   * from the discovery cache when fresh and otherwise skipped after
   * {@link BEST_EFFORT_DISCOVERY_WAIT_MS}; one still queued after
   * {@link BEST_EFFORT_DISCOVERY_START_WINDOW_MS} is skipped unstarted. One that
   * failed or outlived its wait is skipped for the same requester for
   * {@link BEST_EFFORT_RETRY_AFTER_MS}, or until that late discovery succeeds.
   * One with no permitted operations contributes nothing and is not a failure.
   * Their discovery never touches a server's shared status or cooldown, and skips a
   * server the requester cannot authenticate to.
   */
  bestEffort?: string[]
}

function toMothershipMcpTool(tool: {
  serverId: string
  serverName?: string
  name: string
  description?: string
  inputSchema: McpToolSchema | Record<string, unknown>
}): ToolSchema {
  return {
    name: createMcpToolId(tool.serverId, tool.name),
    description:
      tool.description || `MCP tool ${tool.name} from ${tool.serverName || tool.serverId}`,
    input_schema: tool.inputSchema,
    service: `mcp:${tool.serverId}`,
  }
}

/**
 * Resolves MCP server tools into request-local catalog operations. Each server
 * settles on its own: one that cannot be discovered in time, or a named one
 * that lists no permitted operations, is reported in `failures` without
 * discarding the others. Permission-group gating is the caller's, since only it
 * knows whether the request depends on MCP.
 */
export async function buildMcpToolSchemas(
  userId: string,
  workspaceId: string,
  servers: McpDiscoveryServers,
  context?: InternalToolOperationContext
): Promise<McpDiscovery> {
  const complete = [...new Set(servers.complete.filter(Boolean))]
  const bestEffort = [...new Set(servers.bestEffort ?? [])].filter(
    (serverId) => serverId && !complete.includes(serverId)
  )
  if (context && bestEffort.length)
    throw new Error('Executor MCP discovery is limited to the servers its block selected')
  const serverIds = [...complete, ...bestEffort]
  if (serverIds.length === 0) return { tools: [], failures: [] }

  const principal = () =>
    createCopilotChatPrincipal({ userId, workspaceId }, MCP_SERVER_DELEGATION_AUDIENCE)
  const discoverComplete = async (serverId: string) => {
    const tools = context
      ? await discoverMcpServerToolsAsExecutor({ workspaceId, context, serverId })
      : (
          await discoverMcpServerToolsUseCase.execute({
            principal: principal(),
            input: { workspaceId, serverId, requireComplete: true },
          })
        ).tools
    if (!tools.length) throw new Error(`No permitted MCP operations are available for ${serverId}`)
    return tools
  }
  const startWindowEndsAt = Date.now() + BEST_EFFORT_DISCOVERY_START_WINDOW_MS
  /** Ignores the deadline's signal so a slow server's discovery still finishes and warms the cache. */
  const discoverBestEffort = async (serverId: string) => {
    const failureKey = `${workspaceId}:${serverId}:${userId}`
    const recentFailure = recentBestEffortFailures.get(failureKey)
    if (recentFailure) throw recentFailure.error
    if (Date.now() >= startWindowEndsAt) throw new DeadlineExceededError()
    const discovery = discoverMcpServerToolsUseCase.execute({
      principal: principal(),
      input: { workspaceId, serverId, bestEffort: true },
    })
    try {
      const { tools } = await withinDeadline(
        () => discovery,
        Date.now() + BEST_EFFORT_DISCOVERY_WAIT_MS
      )
      return tools
    } catch (error) {
      const failure: BestEffortFailure = { error: toError(error) }
      recentBestEffortFailures.set(failureKey, failure)
      if (error instanceof DeadlineExceededError) {
        const isLatest = () =>
          recentBestEffortFailures.peek(failureKey, { allowStale: true }) === failure
        discovery.then(
          () => {
            if (isLatest()) recentBestEffortFailures.delete(failureKey)
          },
          (lateError: unknown) => {
            if (isLatest()) recentBestEffortFailures.set(failureKey, { error: toError(lateError) })
          }
        )
      }
      throw error
    }
  }

  const [completeOutcomes, bestEffortOutcomes] = await Promise.all([
    Promise.allSettled(complete.map(discoverComplete)),
    mapSettledWithConcurrency(bestEffort, BEST_EFFORT_DISCOVERY_CONCURRENCY, discoverBestEffort),
  ])
  const outcomes = [...completeOutcomes, ...bestEffortOutcomes]

  const seen = new Set<string>()
  const discovery: McpDiscovery = { tools: [], failures: [] }
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      discovery.failures.push({ serverId: serverIds[index], error: toError(outcome.reason) })
      return
    }
    for (const tool of outcome.value.map(toMothershipMcpTool)) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)
      discovery.tools.push(tool)
    }
  })
  return discovery
}
