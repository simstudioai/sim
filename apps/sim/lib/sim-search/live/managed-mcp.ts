import { isRecordLike, toRecord } from '@sim/utils/object'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import { MANAGED_MCP_CONNECTORS } from '@/lib/credential-groups/managed-mcp-connectors'
import { createManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
import { mcpService } from '@/lib/mcp/service'
import { compileMcpToolSchema } from '@/lib/mcp/tool-schema'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import {
  MANAGED_SEARCH_MCP_READ_TOOLS,
  type ManagedSearchMcpProvider,
} from '@/lib/sim-search/live/managed-mcp-config'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'
import { loadOwnManagedMcpRuntime } from '@/lib/sim-search/live/mcp-accounts'

export interface ManagedSearchMcpClient {
  call(name: string, args: Record<string, unknown>): Promise<unknown>
  /** Optional provider features are used only when the current server advertises them. */
  hasTool?(name: string): boolean
  hasArgument?(name: string, path: string): boolean
}

/** Fixed provider, member grant, read allowlist, current schemas, and bounded calls share one owner. */
export async function createManagedSearchMcpClient(
  owner: ResourceOwner,
  userId: string,
  credentialId: string,
  provider: ManagedSearchMcpProvider,
  signal: AbortSignal,
  searches = 1
): Promise<ManagedSearchMcpClient & { close(): Promise<void> }> {
  signal.throwIfAborted()
  const label = MANAGED_MCP_CONNECTORS[provider].name
  const initial = await loadOwnManagedMcpRuntime(owner, userId, credentialId, provider)
  const loadCurrent = async () => {
    signal.throwIfAborted()
    const current = await loadOwnManagedMcpRuntime(owner, userId, credentialId, provider)
    if (
      current.mcpServerId !== initial.mcpServerId ||
      current.oauthConfigVersion !== initial.oauthConfigVersion ||
      current.grantedAt.getTime() !== initial.grantedAt.getTime()
    )
      throw new NativeSearchError('reconnect', `${label} connection changed. Search again.`)
    return current
  }
  const loadProvider = async () => createManagedMcpAuthProvider(await loadCurrent())
  const session = await mcpService.openManagedMcpSession(
    initial.mcpServerId,
    initial.scope,
    { credentialId, loadProvider },
    signal
  )
  const tools = await session
    .listTools(signal, { requireComplete: true })
    .catch(async (error: unknown) => {
      await session.disconnect()
      throw error
    })
  const allowed: readonly string[] = MANAGED_SEARCH_MCP_READ_TOOLS[provider]
  const byName = new Map(
    tools.filter((tool) => allowed.includes(tool.name)).map((tool) => [tool.name, tool])
  )
  const budget = 12 * Math.min(4, Math.max(1, searches))
  let requests = 0
  return {
    close: () => session.disconnect(),
    hasTool: (name) => byName.has(name),
    hasArgument(name, path) {
      let schema: Record<string, unknown> = toRecord(byName.get(name)?.inputSchema)
      for (const key of path.split('.')) {
        const property = toRecord(schema.properties)[key]
        if (!isRecordLike(property)) return false
        schema = property
      }
      return true
    },
    async call(name, args) {
      signal.throwIfAborted()
      if (!allowed.includes(name))
        throw new NativeSearchError('unavailable', `${label} Search permits read-only tools.`)
      if (++requests > budget)
        throw new NativeSearchError(
          'unavailable',
          `${label} read request limit reached. Narrow the query.`
        )
      const tool = byName.get(name)
      if (!tool)
        throw new NativeSearchError(
          'unavailable',
          `${label} no longer advertises ${name}. Reconnect or update the connector.`
        )
      if (!compileMcpToolSchema(tool.inputSchema)(args))
        throw new NativeSearchError(
          'unavailable',
          `${label} rejected these search arguments. Its current tool schema is incompatible with this query.`
        )
      await loadCurrent()
      const result = await session.callTool(
        { name, arguments: args },
        { signal, timeoutMs: 10_000 }
      )
      await loadCurrent()
      return managedMcpPayload(result, label)
    },
  }
}
