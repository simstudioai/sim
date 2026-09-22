import type { ResourceOwner } from '@/lib/core/resource-scope'
import { validateToolArguments } from '@/lib/mcp/application/execute-tool'
import { createManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
import { mcpService } from '@/lib/mcp/service'
import type { McpToolResult } from '@/lib/mcp/types'
import { array, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import { loadOwnCodaMcpRuntime } from '@/lib/sim-search/live/mcp-accounts'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const READ_TOOLS = [
  'search',
  'url_convert',
  'content_read',
  'document_outline',
  'table_rows_read',
] as const
type ReadTool = (typeof READ_TOOLS)[number]
export interface CodaMcpClient {
  call(name: ReadTool, args: Record<string, unknown>): Promise<unknown>
}

/** MCP OAuth remains server-side; the model can never choose a server URL or invoke a write tool. */
export async function createCodaMcpClient(
  owner: ResourceOwner,
  userId: string,
  credentialId: string,
  signal: AbortSignal
): Promise<CodaMcpClient> {
  const initial = await loadOwnCodaMcpRuntime(owner, userId, credentialId)
  const loadCurrent = async () => {
    signal.throwIfAborted()
    const current = await loadOwnCodaMcpRuntime(owner, userId, credentialId)
    if (
      current.mcpServerId !== initial.mcpServerId ||
      current.oauthConfigVersion !== initial.oauthConfigVersion ||
      current.grantedAt.getTime() !== initial.grantedAt.getTime()
    )
      throw new NativeSearchError('reconnect', 'Coda connection changed. Search again.')
    return current
  }
  const loadProvider = async () => createManagedMcpAuthProvider(await loadCurrent())
  const tools = await mcpService.discoverManagedMcpTools(
    initial.mcpServerId,
    initial.scope,
    { credentialId, loadProvider },
    signal,
    { requireComplete: true }
  )
  let requests = 0
  return {
    async call(name, args) {
      if (!READ_TOOLS.includes(name) || ++requests > 12)
        throw new NativeSearchError('unavailable', 'Coda read request limit reached.')
      const tool = tools.find((tool) => tool.name === name)
      if (!tool)
        throw new NativeSearchError(
          'unavailable',
          `Coda no longer advertises ${name}. Reconnect or update the connector.`
        )
      validateToolArguments(tool, args)
      await loadCurrent()
      const result = await mcpService.executeManagedMcpTool({
        connectionId: credentialId,
        serverId: initial.mcpServerId,
        scope: initial.scope,
        toolCall: { name, arguments: args },
        loadAuthProvider: loadProvider,
        signal,
        timeoutMs: 10_000,
      })
      return codaMcpPayload(result)
    },
  }
}

/** Servers may return structuredContent or JSON text blocks. Unknown formats fail visibly. */
export function codaMcpPayload(result: McpToolResult): unknown {
  if (result.isError)
    throw new NativeSearchError(
      'unavailable',
      'Coda could not complete this read. Check the query and your access.'
    )
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
  try {
    return JSON.parse(text)
  } catch {
    if (text) return { text }
    throw new NativeSearchError('unavailable', 'Coda returned no readable content.')
  }
}

function requireCodaUri(uri: string): string {
  if (!/^coda:\/\/docs\/[\w-]+(?:\/[\w-]+)*$/.test(uri) || uri.length > 1000)
    throw new NativeSearchError('unavailable', 'Coda returned an unsupported resource URI.')
  return uri
}
function codaUrl(value: unknown): string {
  try {
    const url = new URL(string(value))
    return url.protocol === 'https:' &&
      ['coda.io', 'docs.superhuman.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}
function readable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export async function searchCodaMcp(
  client: CodaMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const result = object(
    await client.call('search', {
      query: input.native?.query ?? input.query,
      limit: Math.min(input.limit, 10),
      ...(input.native?.project ? { docUri: requireCodaUri(input.native.project) } : {}),
      ...(input.native?.cursor ? { cursor: input.native.cursor } : {}),
    })
  )
  const rows = result.results ?? result.items
  if (!Array.isArray(rows))
    throw new NativeSearchError(
      'unavailable',
      'Coda search returned an unsupported result format; no complete coverage can be claimed.'
    )
  const documents: NativeDocument[] = []
  for (const row of array(rows)) {
    const url = codaUrl(row.url ?? row.webUrl)
    const uri = string(row.uri ?? row.id)
    const id = uri.startsWith('coda://') ? requireCodaUri(uri) : url
    if (!id) continue
    documents.push({
      id,
      kind: 'mcp',
      title: string(row.title ?? row.name) || 'Coda result',
      url,
      content:
        string(row.snippet ?? row.excerpt ?? row.content ?? row.text) ||
        string(row.title ?? row.name),
      modifiedAt: string(row.updatedAt ?? row.modifiedAt),
    })
  }
  const nextCursor = string(result.nextCursor) || undefined
  return {
    documents,
    nextCursor,
    partial: documents.length < rows.length || Boolean(nextCursor),
    message:
      'Coda content search includes pages and table rows. Narrow the query or target a document for more results.',
  }
}

export async function readCodaMcp(client: CodaMcpClient, id: string): Promise<NativeDocument> {
  let uri = id
  let url = codaUrl(id)
  if (url) uri = string(object(await client.call('url_convert', { action: 'decode', url })).uri)
  requireCodaUri(uri)
  if (!url)
    url = codaUrl(object(await client.call('url_convert', { action: 'encode', uri })).webUrl)
  let content: unknown
  const row = uri.match(/^(.*\/(?:tables|views)\/[\w-]+)\/rows\/([\w-]+)$/)
  if (row) {
    content = await client.call('table_rows_read', {
      uri: row[1],
      rowNumbersOrIds: [row[2]],
      rowLimit: 1,
    })
  } else if (/\/(?:tables|views)\/[\w-]+$/.test(uri)) {
    content = await client.call('table_rows_read', { uri, rowLimit: 100 })
    content = {
      data: content,
      coverage: 'First 100 rows only. Search more specifically to retrieve matching rows.',
    }
  } else if (/^coda:\/\/docs\/[\w-]+$/.test(uri)) {
    content = await client.call('document_outline', {
      uri,
      pageLimit: 50,
      includePermissions: false,
    })
    content = {
      outline: content,
      coverage:
        'Document outline only. Search within this document to retrieve and read individual pages or table rows.',
    }
  } else {
    content = await client.call('content_read', {
      uri,
      contentTypesToInclude: ['markdown', 'tables'],
      markdownBlockLimit: 100,
      markdownBlockContentLimit: 4000,
    })
    content = {
      data: content,
      coverage: 'Up to 100 content blocks. Search within the document to find additional sections.',
    }
  }
  return {
    id,
    kind: 'mcp',
    title: string(object(content).title) || 'Coda content',
    url,
    content: readable(content),
  }
}
