import { omit, toRecord } from '@sim/utils/object'
import { z } from 'zod'
import type { ApiSchema, HttpMethod } from '@/lib/api/contracts/types'
import { V2_MCP_OPERATIONS, type V2McpOperationName } from '@/lib/api/mcp/generated/v2-operations'
import type { V2McpOperation } from '@/lib/api/mcp/types'
import { v2RouteOperation } from '@/lib/api/server/routes/v2-json-route'
import { OAUTH_API_READ_SCOPE, oauthScopeSatisfies } from '@/lib/auth/oauth-provider'

/** Headers the dispatcher owns; a contract declaring one still never takes it from a tool call. */
const MANAGED_HEADERS: ReadonlySet<string> = new Set([
  'x-api-key',
  'authorization',
  'accept',
  'content-type',
  'user-agent',
])

/** The tool that runs each kind of operation. */
export const TOOL_NAMES = { read: 'call_read_operation', write: 'call_write_operation' } as const
type ToolKind = keyof typeof TOOL_NAMES

const REQUEST_SLOTS = ['params', 'query', 'body', 'headers'] as const
type RequestSlot = (typeof REQUEST_SLOTS)[number]
type JsonSchema = Record<string, unknown>

/** One catalog row: enough to choose an operation, not to call it. */
interface McpOperationEntry {
  operation: V2McpOperationName
  method: HttpMethod
  path: string
  domain: string
  summary: string
  /** The tool that runs it: the read tool only for operations that need nothing beyond read access. */
  /** Refuses workspace API keys; call it with a personal key or an OAuth connection. */
  personalCredentialOnly?: true
}

interface McpOperationSummary extends McpOperationEntry {
  /** The tool that runs it: the read tool only for operations that need nothing beyond read access. */
  tool: (typeof TOOL_NAMES)[ToolKind]
}

/** Everything needed to call one operation: its documentation plus the JSON Schema of each request slot. */
interface McpOperationDescription extends McpOperationSummary {
  description?: string
  input: Partial<Record<RequestSlot, JsonSchema>>
}

const OPERATION_NAMES = Object.keys(V2_MCP_OPERATIONS) as V2McpOperationName[]

export function getMcpOperation(name: V2McpOperationName): V2McpOperation {
  return V2_MCP_OPERATIONS[name]
}

/** Memo of each operation's tool; a failed load is dropped so the next call retries it. */
const toolKinds = new Map<V2McpOperationName, Promise<ToolKind>>()

/**
 * Which tool runs an operation, from the OAuth scope its route declares rather
 * than its HTTP method: a GET can need `api:write` and reach out to another
 * system, and a POST can be a pure query. Raw routes declare no operation and
 * all change something, so they run through the write tool.
 */
function operationToolKind(name: V2McpOperationName): Promise<ToolKind> {
  const cached = toolKinds.get(name)
  if (cached) return cached
  const kind = getMcpOperation(name)
    .handler()
    .then((route): ToolKind => {
      const scope = v2RouteOperation(route)?.oauthScope
      return scope && oauthScopeSatisfies([OAUTH_API_READ_SCOPE], scope) ? 'read' : 'write'
    })
    .catch((error: unknown) => {
      toolKinds.delete(name)
      throw error
    })
  toolKinds.set(name, kind)
  return kind
}

async function withTool(entry: McpOperationEntry): Promise<McpOperationSummary> {
  return { ...entry, tool: TOOL_NAMES[await operationToolKind(entry.operation)] }
}

function isOperationName(name: string): name is V2McpOperationName {
  return Object.hasOwn(V2_MCP_OPERATIONS, name)
}

/** `/api/v2/tables/[tableId]/rows` → `tables`. */
function domainOf(path: string): string {
  return path.split('/')[3] ?? 'v2'
}

function summarize(name: V2McpOperationName): McpOperationEntry {
  const { contract, summary, workspaceKeyUnsupported } = getMcpOperation(name)
  return {
    operation: name,
    method: contract.method,
    path: contract.path,
    domain: domainOf(contract.path),
    summary: summary ?? `${contract.method} ${contract.path}`,
    ...(workspaceKeyUnsupported ? { personalCredentialOnly: true } : {}),
  }
}

/** Each summary with its lower-cased search fields, built once for the fixed catalog. */
const SEARCH_ENTRIES = OPERATION_NAMES.map((name) => {
  const entry = summarize(name)
  return {
    entry,
    name: name.toLowerCase(),
    summary: entry.summary.toLowerCase(),
    path: entry.path.toLowerCase(),
    description: getMcpOperation(name).description?.toLowerCase() ?? '',
  }
})

/** Every domain the catalog covers, e.g. `tables`, `workflows`, `knowledge`. */
const DOMAINS = [...new Set(SEARCH_ENTRIES.map(({ entry }) => entry.domain))].sort()
const [FIRST_DOMAIN, ...OTHER_DOMAINS] = DOMAINS
if (!FIRST_DOMAIN) throw new Error('The Sim MCP catalog has no operations')
export const OPERATION_DOMAINS: [string, ...string[]] = [FIRST_DOMAIN, ...OTHER_DOMAINS]

/**
 * Ranks operations by keyword and domain. Every term must appear in the
 * operation's name, summary, path, or description; hits in the name rank first.
 */
function rankOperations(
  query: string | undefined,
  domain: string | undefined
): McpOperationEntry[] {
  const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const ranked: Array<{ entry: McpOperationEntry; score: number }> = []
  for (const { entry, name, summary, path, description } of SEARCH_ENTRIES) {
    if (domain && entry.domain !== domain) continue
    let score = 0
    for (const term of terms) {
      const termScore =
        (name.includes(term) ? 4 : 0) +
        (summary.includes(term) ? 3 : 0) +
        (path.includes(term) ? 2 : 0) +
        (description.includes(term) ? 1 : 0)
      if (termScore === 0) {
        score = 0
        break
      }
      score += termScore
    }
    if (score > 0 || terms.length === 0) ranked.push({ entry, score })
  }
  ranked.sort((a, b) => b.score - a.score || a.entry.operation.localeCompare(b.entry.operation))
  return ranked.map(({ entry }) => entry)
}

export async function searchOperations(options: {
  query?: string
  domain?: string
  limit: number
}): Promise<{ total: number; operations: McpOperationSummary[] }> {
  const ranked = rankOperations(options.query, options.domain)
  return {
    total: ranked.length,
    operations: await Promise.all(ranked.slice(0, options.limit).map(withTool)),
  }
}

function toJsonSchema(schema: ApiSchema): JsonSchema {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  return json
}

/**
 * The contract's header schema without the headers the dispatcher owns, or
 * `null` when nothing is left for a caller to set.
 */
function callerHeaderSchema(schema: ApiSchema): JsonSchema | null {
  const json = toJsonSchema(schema)
  const properties = toRecord(json.properties)
  const managed = Object.keys(properties).filter((header) =>
    MANAGED_HEADERS.has(header.toLowerCase())
  )
  const allowed = omit(properties, managed)
  if (Object.keys(allowed).length === 0) return null
  const required = Array.isArray(json.required)
    ? json.required.filter((header) => !managed.includes(header))
    : undefined
  return { ...json, properties: allowed, ...(required ? { required } : {}) }
}

/** Memo over a fixed catalog: at most one entry per operation, never evicted. */
const inputs = new Map<V2McpOperationName, McpOperationDescription['input']>()

/** The JSON Schema of each request slot an operation takes. */
function describeInput(name: V2McpOperationName): McpOperationDescription['input'] {
  const cached = inputs.get(name)
  if (cached) return cached
  const { contract } = getMcpOperation(name)
  const input: McpOperationDescription['input'] = {}
  for (const slot of REQUEST_SLOTS) {
    const schema = contract[slot]
    if (!schema) continue
    if (slot === 'headers') {
      const headers = callerHeaderSchema(schema)
      if (headers) input.headers = headers
      continue
    }
    input[slot] = toJsonSchema(schema)
  }
  inputs.set(name, input)
  return input
}

/** Contract headers a tool call may set. */
export function callerHeaderNames(name: V2McpOperationName): string[] {
  return Object.keys(toRecord(describeInput(name).headers?.properties))
}

export async function describeOperation(
  name: V2McpOperationName
): Promise<McpOperationDescription> {
  const { description } = getMcpOperation(name)
  return {
    ...(await withTool(summarize(name))),
    ...(description ? { description } : {}),
    input: describeInput(name),
  }
}

/** Catalog names close to an unknown one, found by searching its camelCase words. */
function suggestOperations(name: string): string[] {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  for (let count = words.length; count > 0; count--) {
    const ranked = rankOperations(words.slice(0, count).join(' '), undefined)
    if (ranked.length > 0) return ranked.slice(0, 5).map((entry) => entry.operation)
  }
  return []
}

/**
 * Resolves the operation a tool call names, or explains what to call instead:
 * the closest names for an unknown one, or the other tool for the wrong kind.
 * `read` and `write` are the read and write tools; `any` is describe_operation.
 */
export async function resolveOperation(
  name: string,
  tool: ToolKind | 'any'
): Promise<{ operation: V2McpOperationName } | { error: string }> {
  if (!isOperationName(name)) {
    const suggestions = suggestOperations(name)
    return {
      error: `Unknown operation "${name}".${
        suggestions.length > 0 ? ` Closest matches: ${suggestions.join(', ')}.` : ''
      } Use search_operations to find operations.`,
    }
  }
  if (tool === 'any') return { operation: name }
  const kind = await operationToolKind(name)
  if (kind === tool) return { operation: name }
  return {
    error:
      kind === 'write'
        ? `${name} needs write access; run it with ${TOOL_NAMES.write}.`
        : `${name} only reads; run it with ${TOOL_NAMES.read}.`,
  }
}
