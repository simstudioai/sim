import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { listContractFiles, MAX_SCHEMA_DEPTH } from '@/lib/api/contracts/v2/test-utils'

/**
 * Pins which v2 lists are paged.
 *
 * Every v2 list returns the same `{ data, nextCursor }` envelope, but only some
 * accept `limit` + `cursor` and can return a non-null `nextCursor`. That split
 * is a documented part of the public contract (`v2/shared.ts`) and has already
 * drifted once — `GET /api/v2/tables` gained real pagination while its contract
 * docstring still claimed a single full page. Enumerating the two sets here
 * makes the next such change fail a test instead of rotting a comment, and
 * makes flipping a shipped list from full-set to paged a deliberate edit: a
 * `limit` with a default silently truncates callers that read the full set
 * today.
 *
 * The sweep guarantees, for every contract under `contracts/v2` whose response
 * is `mode: 'json'`:
 *
 * - Its response schema is introspectable down to concrete object variants. A
 *   schema the walk cannot resolve is a hard failure, not a silent pass — a
 *   list hidden behind an opaque schema would otherwise never be discovered and
 *   "classifies every v2 list" would succeed vacuously.
 * - A response counts as a list only when *every* variant carries both `data`
 *   and `nextCursor`. A union where only some variants are list-shaped throws:
 *   that is a genuine design decision (is it paged or not?), not something a
 *   pinning test should quietly pick a side on.
 * - Each discovered list's `query` and `body` are introspectable too, and the
 *   pagination params are read per variant. The full-set assertion uses
 *   *any-member* presence, so a defaulted `limit` added to a single union
 *   member still fails; the paged assertion uses *all-member* presence, so a
 *   paged list must offer `limit` + `cursor` on every accepted input shape.
 *
 * `mode !== 'json'` contracts (binary/stream downloads) are skipped — they have
 * no JSON envelope to classify.
 */

/** Lists that accept `limit` + `cursor` and can return a non-null `nextCursor`. */
const PAGED_LISTS = [
  'GET /api/v2/organizations/[organizationId]/usage/events',
  'GET /api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces',
  'GET /api/v2/organizations/[organizationId]/access-requests',
  'GET /api/v2/organizations/[organizationId]/access-requests/mine',
  'GET /api/v2/workspaces/[workspaceId]/access-requests',
  'GET /api/v2/organizations/[organizationId]/access-requests/discovery',
  'GET /api/v2/workspaces/[workspaceId]/access-requests/discovery',

  'GET /api/v2/organizations',
  'GET /api/v2/organizations/[organizationId]/members',
  'GET /api/v2/organizations/[organizationId]/invitations',
  'GET /api/v2/organizations/[organizationId]/workspaces',
  'GET /api/v2/organizations/[organizationId]/permission-groups',
  'GET /api/v2/organizations/[organizationId]/permission-groups/[groupId]/members',

  'GET /api/v2/audit-logs',
  'GET /api/v2/billing/logs',
  'GET /api/v2/blocks',
  'GET /api/v2/chat-deployments',
  'GET /api/v2/connector-types',
  'GET /api/v2/credentials',
  'GET /api/v2/custom-tools',
  'GET /api/v2/files',
  'GET /api/v2/files/[fileId]/versions',
  'GET /api/v2/knowledge',
  'GET /api/v2/knowledge/[knowledgeBaseId]/connectors',
  'GET /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents',
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents',
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
  'GET /api/v2/logs',
  'GET /api/v2/mcp-servers',
  'GET /api/v2/sandboxes',
  'GET /api/v2/secrets',
  'GET /api/v2/skills',
  'GET /api/v2/skills/[skillId]/editors',
  'GET /api/v2/tables',
  'GET /api/v2/tables/[tableId]/rows',
  'POST /api/v2/tables/[tableId]/query',
  'GET /api/v2/tools',
  'GET /api/v2/workflows',
  'GET /api/v2/workflows/[workflowId]/runs',
  'GET /api/v2/workflows/[workflowId]/versions',
  'GET /api/v2/workflow-mcp-servers',
  'GET /api/v2/workspaces/[workspaceId]/members',
  'GET /api/v2/workspaces/[workspaceId]/fork/children',
  'GET /api/v2/workspaces/[workspaceId]/fork/mappings',
  'GET /api/v2/workspaces/[workspaceId]/fork/resources',
  'GET /api/v2/workspaces/[workspaceId]/operations',
  'POST /api/v2/selectors/list',
  'GET /api/v2/workspaces',
] as const

/**
 * Lists that accept neither param and always return `nextCursor: null`, because
 * the set is small and bounded per workspace, per table, or per server.
 *
 * Every entry is bounded by construction rather than by a caller's `limit`:
 *
 * - The four folder lists are capped where the tree is loaded
 *   (`MAX_*_FOLDERS_PER_WORKSPACE`).
 * - One MCP server's tool inventory is capped by tool discovery itself
 *   (`LIST_TOOLS_MAX_TOOLS` / `LIST_TOOLS_MAX_BYTES`), whatever the upstream
 *   server reports. The MCP *server* list is not bounded that way — nothing caps
 *   how many servers a workspace registers — which is why it is paged and does
 *   not appear here.
 * - The credential-provider catalog is bounded by the code-defined OAuth and
 *   service-account registries.
 * - The connector-type catalog is bounded the same way, by the code-defined
 *   connector-meta registry. The block and tool
 *   catalogs are NOT — a workspace adds blocks by deploying workflows as blocks,
 *   and there are ~5,000 tool ids — which is why those two are paged and do not
 *   appear here.
 * - A knowledge base has a fixed number of tag slots, so neither its tag
 *   vocabulary nor the usage counts derived from it can grow past them.
 * - A table's saved views and its dispatchable groups are capped per table.
 * - A table's ACTIVE run dispatches are capped by the dispatcher itself: it
 *   keeps at most a handful in flight per table and cancels the rest, so the
 *   set cannot grow with a workspace's size. Settled dispatches are read by id,
 *   never listed.
 */
const FULL_SET_LISTS = [
  'GET /api/v2/credentials/providers',
  'GET /api/v2/files/folders',
  'GET /api/v2/knowledge/[knowledgeBaseId]/tags',
  'GET /api/v2/knowledge/[knowledgeBaseId]/tags/usage',
  'GET /api/v2/knowledge/folders',
  'GET /api/v2/mcp-servers/[mcpServerId]/tools',
  'GET /api/v2/workflow-mcp-servers/[serverId]/tools',
  'GET /api/v2/tables/[tableId]/dispatches',
  'GET /api/v2/tables/[tableId]/groups',
  'GET /api/v2/tables/[tableId]/views',
  'GET /api/v2/tables/folders',
  'GET /api/v2/workflows/folders',
] as const

/**
 * Which of each paged list's params its cursor is bound to.
 *
 * A cursor names a position in ONE sequence, and every param that reorders or
 * re-filters that sequence decides which sequence that is. Replay a cursor
 * across a change to any of them and the reply is wrong in a way the caller
 * cannot see: an offset lands at an unrelated ordinal, and a keyset — which
 * stays internally coherent — silently drops every match that sorts before its
 * position. So all of them are stamped into the token and re-checked on the way
 * back in, and a mismatch is a 400 telling the caller to restart paging.
 *
 * The stamp is applied by the route through `cursorScopeKey` +
 * `cursorSortKey` (`app/api/v2/lib/response.ts`), or, for the three lists whose
 * token is minted by a domain codec, by wrapping it with `encodeScopedCursor`.
 * The table-row lists bind inside their own codec (`lib/table/rows/cursor.ts`)
 * against the same fingerprint.
 *
 * This map is the declaration; the tests below check it against what each
 * contract actually accepts, in both directions. A list that gains a filter
 * therefore fails here until someone decides whether the cursor is bound to it.
 */
const CURSOR_BINDINGS: Record<string, readonly string[]> = {
  'GET /api/v2/organizations/[organizationId]/usage/events': [
    'preset',
    'startDate',
    'endDate',
    'timezone',
    'source',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces': [
    'search',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/organizations/[organizationId]/access-requests': [
    'status',
    'search',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/organizations/[organizationId]/access-requests/mine': [
    'status',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/workspaces/[workspaceId]/access-requests': ['status', 'sortBy', 'sortOrder'],
  'GET /api/v2/organizations/[organizationId]/access-requests/discovery': [
    'search',
    'targetKind',
    'state',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/workspaces/[workspaceId]/access-requests/discovery': [
    'search',
    'targetKind',
    'state',
    'sortBy',
    'sortOrder',
  ],

  'GET /api/v2/organizations': ['search', 'sortBy', 'sortOrder'],
  'GET /api/v2/organizations/[organizationId]/members': ['search', 'sortBy', 'sortOrder'],
  'GET /api/v2/organizations/[organizationId]/invitations': [
    'search',
    'status',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/organizations/[organizationId]/workspaces': ['search', 'sortBy', 'sortOrder'],
  'GET /api/v2/organizations/[organizationId]/permission-groups': ['search', 'sortBy', 'sortOrder'],
  'GET /api/v2/organizations/[organizationId]/permission-groups/[groupId]/members': [
    'sortBy',
    'sortOrder',
  ],

  'GET /api/v2/audit-logs': [
    'includeDeparted',
    'action',
    'resourceType',
    'resourceId',
    'workspaceId',
    'actorEmail',
    'startDate',
    'endDate',
  ],
  'GET /api/v2/billing/logs': ['source', 'workspaceId', 'period', 'startDate', 'endDate'],
  'GET /api/v2/blocks': [
    'workspaceId',
    'search',
    /** Admits sunset blocks into the sequence. */
    'includeSunset',
    'category',
    'capability',
    'source',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/connector-types': ['workspaceId', 'search', 'detail'],
  'GET /api/v2/credentials': ['workspaceId', 'type', 'providerId', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/custom-tools': ['workspaceId', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/files': [
    'workspaceId',
    'scope',
    'folderPath',
    'search',
    'sortBy',
    'sortOrder',
    /** Decides whether `folderPath` covers one folder or its whole subtree. */
    'recursive',
  ],
  'GET /api/v2/files/[fileId]/versions': ['sortBy', 'sortOrder'],
  'GET /api/v2/knowledge': ['workspaceId', 'scope', 'folderPath', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/knowledge/[knowledgeBaseId]/connectors': ['workspaceId', 'sortBy', 'sortOrder'],
  'GET /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents': [
    'workspaceId',
    'includeExcluded',
  ],
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents': [
    // Asserted scope rather than a filter, but this list shipped before the
    // distinction was drawn. The value is constant for any one sequence, so
    // keeping it costs nothing; removing it would refuse every cursor already
    // in flight. The chunks list below is new, so it starts out unbound.
    'workspaceId',
    'enabledFilter',
    'search',
    'tagFilters',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks': [
    'enabled',
    'search',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/logs': [
    'workspaceId',
    'workflowIds',
    'triggers',
    'level',
    'startDate',
    'endDate',
    'runId',
    'minDurationMs',
    'maxDurationMs',
    'minCost',
    'maxCost',
    'model',
    'folderPaths',
    'sortBy',
    'sortOrder',
    'status',
    'workflowName',
    /** Decides whether the job-run branch is part of the sequence at all. */
    'includeJobRuns',
    /** Widens what `level=error` selects, so it changes the sequence. */
    'includeHandledErrors',
  ],
  'GET /api/v2/mcp-servers': ['workspaceId', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/sandboxes': ['workspaceId', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/secrets': ['workspaceId', 'scope', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/skills': ['workspaceId', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/tables': ['workspaceId', 'scope', 'folderPath', 'search', 'sortBy', 'sortOrder'],
  'GET /api/v2/skills/[skillId]/editors': ['workspaceId', 'sortBy', 'sortOrder'],
  'GET /api/v2/tables/[tableId]/rows': [],
  'POST /api/v2/tables/[tableId]/query': ['predicate', 'sort'],
  'GET /api/v2/tools': [
    'workspaceId',
    'search',
    'hostedApiKey',
    'oauthProvider',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/workflows': [
    'workspaceId',
    'folderPath',
    'scope',
    'deployedOnly',
    'search',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/workflows/[workflowId]/runs': ['status', 'trigger', 'startDate', 'endDate', 'order'],
  'GET /api/v2/workflows/[workflowId]/versions': [],
  'GET /api/v2/workflow-mcp-servers': ['workspaceId', 'sortBy', 'sortOrder'],
  'GET /api/v2/chat-deployments': ['workspaceId', 'workflowId', 'isActive', 'sortBy', 'sortOrder'],
  'GET /api/v2/workspaces/[workspaceId]/members': [],
  'GET /api/v2/workspaces/[workspaceId]/fork/children': ['sortBy', 'sortOrder'],
  'GET /api/v2/workspaces/[workspaceId]/fork/mappings': [
    'otherWorkspaceId',
    'direction',
    'sortBy',
    'sortOrder',
  ],
  'GET /api/v2/workspaces/[workspaceId]/fork/resources': ['kind', 'sortBy', 'sortOrder'],
  'GET /api/v2/workspaces/[workspaceId]/operations': ['requestId'],
  'POST /api/v2/selectors/list': ['workspaceId', 'selectorKey', 'context', 'search'],
  'GET /api/v2/workspaces': ['sortBy', 'sortOrder'],
}

/**
 * The path params each nested paged list binds its cursor to — the ones that
 * name WHICH parent resource the sequence belongs to.
 *
 * {@link CURSOR_BINDINGS} covers only what a contract accepts as query or body,
 * so a nested list's parent id is invisible to it: an empty binding there reads
 * the same whether the list genuinely has no filters or whether its parent was
 * forgotten. Both readings were true at once — `GET /workflows/[workflowId]/versions`
 * and `GET /workspaces/[workspaceId]/members` declared `[]`, accepted a sibling
 * parent's token, and answered 200 from a position in a sequence the caller
 * never walked.
 *
 * Every placeholder in a paged list's path is bound, with no exemptions. A path
 * param is never merely an asserted scope the way a `workspaceId` *query* param
 * is on the table lists — that one is refused by authorization before paging,
 * which is why it is exempted in {@link UNBOUND_PARAMS} instead. A placeholder
 * is what picks the sequence out, so leaving one unbound is exactly the defect
 * above. Routes apply this through `cursorRoute(contract, params)`, which
 * resolves the path before fingerprinting it.
 */
const CURSOR_BOUND_PATH_PARAMS: Record<string, readonly string[]> = {
  'GET /api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces': [
    'organizationId',
    'invitationId',
  ],
  'GET /api/v2/organizations/[organizationId]/access-requests': ['organizationId'],
  'GET /api/v2/organizations/[organizationId]/access-requests/mine': ['organizationId'],
  'GET /api/v2/workspaces/[workspaceId]/access-requests': ['workspaceId'],
  'GET /api/v2/organizations/[organizationId]/access-requests/discovery': ['organizationId'],
  'GET /api/v2/workspaces/[workspaceId]/access-requests/discovery': ['workspaceId'],
  'GET /api/v2/organizations/[organizationId]/usage/events': ['organizationId'],

  'GET /api/v2/organizations/[organizationId]/members': ['organizationId'],
  'GET /api/v2/organizations/[organizationId]/invitations': ['organizationId'],
  'GET /api/v2/organizations/[organizationId]/workspaces': ['organizationId'],
  'GET /api/v2/organizations/[organizationId]/permission-groups': ['organizationId'],
  'GET /api/v2/organizations/[organizationId]/permission-groups/[groupId]/members': [
    'organizationId',
    'groupId',
  ],

  'GET /api/v2/files/[fileId]/versions': ['fileId'],
  'GET /api/v2/knowledge/[knowledgeBaseId]/connectors': ['knowledgeBaseId'],
  'GET /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents': [
    'knowledgeBaseId',
    'connectorId',
  ],
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents': ['knowledgeBaseId'],
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks': [
    'knowledgeBaseId',
    'documentId',
  ],
  'GET /api/v2/skills/[skillId]/editors': ['skillId'],
  'GET /api/v2/tables/[tableId]/rows': ['tableId'],
  'POST /api/v2/tables/[tableId]/query': ['tableId'],
  'GET /api/v2/workflows/[workflowId]/runs': ['workflowId'],
  'GET /api/v2/workflows/[workflowId]/versions': ['workflowId'],
  'GET /api/v2/workspaces/[workspaceId]/members': ['workspaceId'],
  'GET /api/v2/workspaces/[workspaceId]/fork/children': ['workspaceId'],
  'GET /api/v2/workspaces/[workspaceId]/fork/mappings': ['workspaceId'],
  'GET /api/v2/workspaces/[workspaceId]/fork/resources': ['workspaceId'],
  'GET /api/v2/workspaces/[workspaceId]/operations': ['workspaceId'],
}

/**
 * Params a paged list accepts that its cursor is deliberately NOT bound to,
 * with the reason. Anything not listed here and not in {@link CURSOR_BINDINGS}
 * fails the sweep.
 *
 * `limit` is excluded globally rather than per list: it selects how much of the
 * sequence to return, not what the sequence is, so a caller is free to change
 * page size mid-walk and binding it would strand every cursor for no
 * correctness gain.
 */
const UNBOUND_PARAMS: Record<string, Record<string, string>> = {
  'GET /api/v2/files/[fileId]/versions': {
    workspaceId:
      'Asserted scope, not a filter: the sequence is one file, named by the path. A mismatched workspace is refused by authorization before paging.',
  },
  'GET /api/v2/audit-logs': {
    organizationId:
      'Asserted scope, not a filter: an account belongs to at most one organization, so naming it and omitting it select the same sequence. The resolved id is decided inside the application use case, so the route cannot stamp it without resolving an authorization decision itself.',
  },
  'GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks': {
    workspaceId:
      'Asserted scope, not a filter: the sequence is one document, named by the path. A mismatched workspace is refused by authorization before paging.',
  },
  'GET /api/v2/logs': {
    details: 'Selects how much of each row is rendered, not which rows are in the sequence.',
    includeTraceSpans: 'Response shaping only; the row set and its order are unchanged.',
    includeFinalOutput: 'Response shaping only; the row set and its order are unchanged.',
  },
  'GET /api/v2/tables/[tableId]/rows': {
    workspaceId:
      'Asserted scope, not a filter: the sequence is one table, named by the path. A mismatched workspace is refused by authorization before paging.',
    includeRunState: 'Response shaping only; the row set and its order are unchanged.',
  },
  'POST /api/v2/tables/[tableId]/query': {
    workspaceId:
      'Asserted scope, not a filter: the sequence is one table, named by the path. A mismatched workspace is refused by authorization before paging.',
    includeRunState: 'Response shaping only; the row set and its order are unchanged.',
  },
}

/** Never part of a binding, on any list. */
const NEVER_BOUND = new Set<string>(['limit', 'cursor'])

/**
 * Lists that deliberately truncate a fractional `limit` instead of rejecting it.
 *
 * These three shipped that leniency and published it in their OpenAPI
 * description, so tightening them would turn a currently-successful request into
 * an error. Everything else must reject — see the fractional-limit test below.
 */
const CLAMPED_LIMIT_LISTS = new Set<string>([
  'GET /api/v2/files',
  'GET /api/v2/logs',
  'GET /api/v2/tables',
])

interface ContractLike {
  method: string
  path: string
  query?: z.ZodType
  body?: z.ZodType
  response?: { mode: string; schema?: z.ZodType }
}

function isContract(value: unknown): value is ContractLike {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ContractLike).method === 'string' &&
    typeof (value as ContractLike).path === 'string' &&
    typeof (value as ContractLike).response === 'object'
  )
}

const PAGINATION_PARAMS = ['limit', 'cursor'] as const

/**
 * Resolves a schema to the key sets of every concrete object variant it can
 * accept, or `null` when it cannot be resolved.
 *
 * Unions contribute one entry per member, intersections the cross-product union
 * of both sides, wrappers (`.optional()` / `.default()` / `.nullable()` /
 * `.catch()` / `.readonly()` / pipes) recurse into the inner (input) type, and
 * `z.lazy` is forced once under the depth cap. Returning `null` rather than an
 * empty shape is what lets callers treat "cannot introspect" as a failure
 * instead of "has no keys".
 */
function variantKeySets(schema: unknown, depth: number = MAX_SCHEMA_DEPTH): string[][] | null {
  if (!schema || depth <= 0) return null
  const def = (schema as { def?: Record<string, unknown> }).def
  if (!def) return null

  switch (def.type) {
    case 'object':
      return [Object.keys(def.shape as Record<string, unknown>)]
    case 'union': {
      const options = def.options as unknown[] | undefined
      if (!options?.length) return null
      const variants: string[][] = []
      for (const option of options) {
        const sets = variantKeySets(option, depth - 1)
        if (!sets) return null
        variants.push(...sets)
      }
      return variants
    }
    case 'intersection': {
      const left = variantKeySets(def.left, depth - 1)
      const right = variantKeySets(def.right, depth - 1)
      if (!left || !right) return null
      return left.flatMap((l) => right.map((r) => [...new Set([...l, ...r])]))
    }
    case 'lazy': {
      const getter = def.getter
      if (typeof getter !== 'function') return null
      try {
        return variantKeySets(getter(), depth - 1)
      } catch {
        return null
      }
    }
    default: {
      const inner = def.innerType ?? def.in ?? def.schema
      return inner ? variantKeySets(inner, depth - 1) : null
    }
  }
}

/**
 * Whether a response is the `{ data, nextCursor }` envelope. Throws when the
 * schema is opaque, or when a union is only partly list-shaped.
 */
function isListResponse(label: string, schema: z.ZodType | undefined): boolean {
  const variants = variantKeySets(schema)
  if (!variants) {
    throw new Error(
      `${label}: v2 json response schema could not be introspected. Teach variantKeySets about it — an opaque response silently hides a list from this sweep.`
    )
  }
  const listy = variants.filter((keys) => keys.includes('data') && keys.includes('nextCursor'))
  if (listy.length === 0) return false
  if (listy.length === variants.length) return true
  throw new Error(
    `${label}: response union mixes ${listy.length} list-shaped variant(s) with ${
      variants.length - listy.length
    } non-list variant(s). Whether this endpoint is paged must be a deliberate decision, not an accident of union ordering.`
  )
}

/** Key sets of every input shape the contract accepts across `query` × `body`. */
function inputVariants(label: string, contract: ContractLike): string[][] {
  let variants: string[][] = [[]]
  for (const [slot, schema] of [
    ['query', contract.query],
    ['body', contract.body],
  ] as const) {
    if (!schema) continue
    const sets = variantKeySets(schema)
    if (!sets) {
      throw new Error(
        `${label}: ${slot} schema of a v2 list could not be introspected, so its pagination params cannot be checked.`
      )
    }
    variants = variants.flatMap((base) => sets.map((s) => [...new Set([...base, ...s])]))
  }
  return variants
}

/**
 * `any` fails a full-set list the moment one input shape gains a pagination
 * param; `all` requires a paged list to offer them on every input shape.
 */
function paginationParams(variants: string[][]): { any: string[]; all: string[] } {
  return {
    any: PAGINATION_PARAMS.filter((param) => variants.some((keys) => keys.includes(param))),
    all: PAGINATION_PARAMS.filter((param) => variants.every((keys) => keys.includes(param))),
  }
}

/**
 * Whether a fractional `limit` is rejected by whichever slot carries it.
 *
 * The other required params are left out on purpose: the schema reports every
 * failure at once, so it is enough to ask whether one of them is about `limit`.
 * That keeps this free of per-resource fixtures and lets it run over every list
 * the sweep finds — which matters, because the one list that still carried the
 * original `LIMIT 2.5` defect was the one nobody remembered to add to a
 * hand-written list.
 */
function rejectsFractionalLimit(contract: ContractLike): boolean {
  for (const schema of [contract.query, contract.body]) {
    if (!schema) continue
    const result = schema.safeParse({ limit: '1.5' })
    if (!result.success && result.error.issues.some((issue) => issue.path[0] === 'limit')) {
      return true
    }
  }
  return false
}

interface V2ListContract {
  key: string
  name: string
  params: { any: string[]; all: string[] }
  /** Every param name the contract accepts, across `query` and `body`. */
  inputKeys: string[]
  /** Whether a fractional `limit` draws a validation issue on `limit` itself. */
  rejectsFractionalLimit: boolean
}

/**
 * Sweeping the contracts tree costs a few hundred dynamic imports, so it is done
 * once for the whole file rather than repeated per test.
 */
let contractsPromise: Promise<V2ListContract[]> | null = null
function loadV2ListContracts(): Promise<V2ListContract[]> {
  contractsPromise ??= sweepV2ListContracts()
  return contractsPromise
}

async function sweepV2ListContracts(): Promise<V2ListContract[]> {
  const found = new Map<string, V2ListContract>()
  for (const file of listContractFiles()) {
    const mod = (await import(file)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!isContract(value)) continue
      if (!value.path.startsWith('/api/v2/')) continue
      if (value.response?.mode !== 'json') continue
      const key = `${value.method.toUpperCase()} ${value.path}`
      const label = `${name} (${key})`
      if (!isListResponse(label, value.response?.schema)) continue
      if (found.has(key)) continue
      const variants = inputVariants(label, value)
      found.set(key, {
        key,
        name,
        params: paginationParams(variants),
        inputKeys: [...new Set(variants.flat())].sort(),
        rejectsFractionalLimit: rejectsFractionalLimit(value),
      })
    }
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Only the first test pays for the sweep; the rest await the memoized promise.
 * It costs ~2s standalone but has exceeded the default 10s under full-suite
 * thread contention, so it gets headroom the other two do not need.
 */
const SWEEP_TIMEOUT_MS = 60_000

describe('v2 list pagination split', () => {
  it(
    'classifies every v2 list as paged or full-set',
    async () => {
      const contracts = await loadV2ListContracts()
      const classified = new Set<string>([...PAGED_LISTS, ...FULL_SET_LISTS])
      const unclassified = contracts.filter((c) => !classified.has(c.key)).map((c) => c.key)

      expect(
        unclassified,
        'A new v2 list must be classified in PAGED_LISTS or FULL_SET_LISTS. See .agents/skills/v2-api-conventions/SKILL.md.'
      ).toEqual([])
      expect(contracts.map((c) => c.key).sort()).toEqual([...classified].sort())
    },
    SWEEP_TIMEOUT_MS
  )

  it('gives every paged list both limit and cursor', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of PAGED_LISTS) {
      expect(
        byKey.get(key)?.params.all,
        `${key} is declared paged, so every input shape it accepts must offer limit and cursor. See .agents/skills/v2-api-conventions/SKILL.md.`
      ).toEqual(['limit', 'cursor'])
    }
  })

  it('gives every full-set list neither limit nor cursor', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of FULL_SET_LISTS) {
      expect(
        byKey.get(key)?.params.any,
        `${key} returns the full set; adding a defaulted limit to any accepted input shape would truncate existing callers. See .agents/skills/v2-api-conventions/SKILL.md.`
      ).toEqual([])
    }
  })

  it('never lets a fractional limit reach the query as a fractional LIMIT', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of PAGED_LISTS) {
      if (CLAMPED_LIMIT_LISTS.has(key)) continue
      expect(
        byKey.get(key)?.rejectsFractionalLimit,
        `${key} accepts a fractional limit, which reaches Postgres as \`LIMIT 2.5\` and answers 500. Build the param from v2PaginationFields. See .agents/skills/v2-api-conventions/SKILL.md.`
      ).toBe(true)
    }
  })

  it('makes every paged list declare what its cursor is bound to', async () => {
    const contracts = await loadV2ListContracts()
    const declared = new Set(Object.keys(CURSOR_BINDINGS))

    expect(
      contracts.filter((c) => PAGED_LISTS.includes(c.key as never) && !declared.has(c.key)),
      'A paged v2 list must declare its cursor binding in CURSOR_BINDINGS. A cursor names a position in one sequence; every param that decides that sequence has to be stamped into the token, or replaying it across a filter change answers from a sequence the caller never asked for.'
    ).toEqual([])
    expect([...declared].sort()).toEqual([...PAGED_LISTS].sort())
  })

  it('binds every paged list to the parent its path names', () => {
    for (const key of PAGED_LISTS) {
      const placeholders = [...key.matchAll(/\[([^\]]+)\]/g)].map(([, name]) => name)

      expect(
        [...(CURSOR_BOUND_PATH_PARAMS[key] ?? [])].sort(),
        `${key} does not bind its cursor to the path param naming its parent resource. Pass it through cursorRoute(contract, params) in the route and declare it in CURSOR_BOUND_PATH_PARAMS; otherwise a sibling parent's token decodes cleanly here and answers from a sequence the caller never walked.`
      ).toEqual(placeholders.sort())
    }
  })

  it('binds every sequence-affecting param a paged list accepts', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of PAGED_LISTS) {
      const contract = byKey.get(key)
      if (!contract) throw new Error(`${key} was not discovered by the contract sweep`)
      const accounted = new Set([
        ...CURSOR_BINDINGS[key],
        ...Object.keys(UNBOUND_PARAMS[key] ?? {}),
        ...NEVER_BOUND,
      ])

      expect(
        contract.inputKeys.filter((param) => !accounted.has(param)),
        `${key} accepts a param its cursor neither binds nor exempts. Add it to CURSOR_BINDINGS and stamp it in the route, or record why it cannot change the sequence in UNBOUND_PARAMS.`
      ).toEqual([])
    }
  })

  it('never declares a binding on a param the contract does not accept', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of PAGED_LISTS) {
      const accepted = new Set(byKey.get(key)?.inputKeys ?? [])

      expect(
        [...CURSOR_BINDINGS[key], ...Object.keys(UNBOUND_PARAMS[key] ?? {})].filter(
          (param) => !accepted.has(param)
        ),
        `${key} declares a cursor binding for a param it no longer accepts. A renamed filter leaves the stamp reading undefined on both sides, which silently restores the mid-walk filter change this map exists to prevent.`
      ).toEqual([])
    }
  })
})
