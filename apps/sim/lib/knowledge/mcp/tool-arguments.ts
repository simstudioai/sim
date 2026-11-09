import { isRecordLike } from '@sim/utils/object'
import type { z } from 'zod'
import {
  chatSearchMcpSchema,
  liveSearchMcpSchema,
  readLiveDocumentMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'
import { mcpToolCallParamsSchema } from '@/lib/api/contracts/mcp'
import { liveSearchProviderSchema } from '@/lib/api/contracts/mothership-assistant-tools'

/** Search filters a client sometimes writes on each native query instead of on the search. */
const SEARCH_FILTERS_ON_NATIVE_QUERIES = [
  'startDate',
  'endDate',
  'modifiedAfter',
  'modifiedBefore',
  'sortBy',
  'topK',
] as const

/** Keyed by client-supplied tool names, so a name such as `constructor` finds nothing. */
const TOOL_INPUT_SCHEMAS = new Map<string, z.ZodType>([
  ['search', liveSearchMcpSchema],
  ['read_document', readLiveDocumentMcpSchema],
  ['chat', chatSearchMcpSchema],
])

function readToolCall(message: Record<string, unknown>) {
  if (message.method !== 'tools/call') return undefined
  const params = mcpToolCallParamsSchema.safeParse(message.params)
  return params.success ? params.data : undefined
}

/**
 * Search arguments rewritten where the schema rejects them but they have exactly one reading: an
 * empty `nativeQueries` list, a null optional native query field, a top-level `provider` naming a
 * provider (the `source` filter), and a search filter every native query carries with the same value. Native
 * queries that disagree on a filter are left for the schema to reject.
 */
function repairSearchArguments(args: Record<string, unknown>) {
  const { nativeQueries: queries, provider, ...rest } = args
  const repaired: Record<string, unknown> = rest
  const repairs = new Set<string>()
  const providerId = liveSearchProviderSchema.safeParse(provider)
  if (providerId.success && (rest.source === undefined || rest.source === providerId.data)) {
    repaired.source = providerId.data
    repairs.add('providerAsSource')
  } else if (provider !== undefined) repaired.provider = provider
  if (Array.isArray(queries) && queries.length === 0) repairs.add('emptyNativeQueries')
  else if (queries !== undefined) repaired.nativeQueries = queries
  if (!Array.isArray(queries) || !queries.length || !queries.every(isRecordLike))
    return { args: repaired, repairs }
  let items = queries.map((query) =>
    Object.fromEntries(
      Object.entries(query).filter(([key, value]) => {
        if (value !== null || key === 'provider' || key === 'query') return true
        repairs.add('nullNativeQueryField')
        return false
      })
    )
  )
  for (const filter of SEARCH_FILTERS_ON_NATIVE_QUERIES) {
    if (!items.some((item) => filter in item)) continue
    /** A query without the filter adds `undefined`, so a filter not on every query differs too. */
    const values = new Set(items.map((item) => JSON.stringify(item[filter])))
    const [value] = values
    if (values.size !== 1 || value === undefined) continue
    if (filter in repaired && JSON.stringify(repaired[filter]) !== value) continue
    repaired[filter] = JSON.parse(value)
    items = items.map(({ [filter]: _, ...rest }) => rest)
    repairs.add('nativeQueryFilterAsSearchFilter')
  }
  repaired.nativeQueries = items
  return { args: repaired, repairs }
}

/**
 * The JSON-RPC message with a search call's arguments repaired before the SDK validates them, so
 * a call the client clearly meant runs instead of costing it another round. Arguments the schema
 * already accepts, other tools, and tools/list come back unchanged.
 */
export function repairToolCallMessage(message: Record<string, unknown>) {
  const call = readToolCall(message)
  if (call?.name !== 'search' || !call.arguments) return { message, repairs: [] }
  const { args, repairs } = repairSearchArguments(call.arguments)
  if (!repairs.size) return { message, repairs: [] }
  return { message: { ...message, params: { ...call, arguments: args } }, repairs: [...repairs] }
}

/**
 * Where a tool call's arguments fail its input schema, as field paths and issue codes without
 * values. The SDK rejects such a call before the tool runs, so nothing else records it.
 */
export function toolCallInputIssues(message: Record<string, unknown>) {
  const call = readToolCall(message)
  const schema = call ? TOOL_INPUT_SCHEMAS.get(call.name) : undefined
  if (!call || !schema) return undefined
  const parsed = schema.safeParse(call.arguments ?? {})
  if (parsed.success) return undefined
  return {
    toolName: call.name,
    issues: parsed.error.issues.map(({ code, path }) => ({ code, path: path.join('.') })),
  }
}
