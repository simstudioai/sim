// GENERATED — do not edit. Source: Sim apps/sim/lib/api/contracts/mothership-assistant-tools.ts
// Regenerate with `bun run generate:cli-inventory` in the worker.

import { z } from 'zod'

export const liveSearchProviderSchema = z.enum([
  'google_drive',
  'gmail',
  'google_meet',
  'zoom',
  'google_calendar',
  'slack',
  'jira',
  'confluence',
  'github',
  'gitlab',
  'linear',
  'lucid',
  'hubspot',
  'fireflies',
  'granola',
  'notion',
  'coda',
])
export type LiveSearchProvider = z.output<typeof liveSearchProviderSchema>

/**
 * Native queries one call may send to the same provider account. Alternatives run as separate
 * provider searches and fuse into one ranking, so the bound keeps a call within the provider's
 * burst limits (Slack allows about ten searches per user per minute) while leaving room for the
 * four independently searchable kinds in GitHub, GitLab, or HubSpot.
 */
export const MAX_NATIVE_QUERIES_PER_ACCOUNT = 4

/**
 * Providers whose kind selects a distinct search collection. A query without a kind fans out
 * across its provider's default collections, so it cannot share an account with kinded queries;
 * the per-account request limit bounds the rest.
 */
const PROVIDER_KIND_SCHEMAS = {
  github: z.enum(['issues', 'code', 'repositories', 'commits']),
  gitlab: z.enum(['issues', 'code', 'merge_requests', 'wiki']),
  hubspot: z.enum(['contacts', 'companies', 'deals', 'tickets']),
  lucid: z.enum(['lucidchart', 'lucidspark']),
  google_meet: z.enum(['transcript', 'smart_notes']),
  zoom: z.enum(['meeting']),
} as const

function hasSearchKinds(
  provider: LiveSearchProvider
): provider is keyof typeof PROVIDER_KIND_SCHEMAS {
  return Object.hasOwn(PROVIDER_KIND_SCHEMAS, provider)
}

const nativeSearchKindSchema = z.enum([
  ...PROVIDER_KIND_SCHEMAS.github.options,
  ...PROVIDER_KIND_SCHEMAS.gitlab.options,
  ...PROVIDER_KIND_SCHEMAS.hubspot.options,
  ...PROVIDER_KIND_SCHEMAS.lucid.options,
  ...PROVIDER_KIND_SCHEMAS.google_meet.options,
  ...PROVIDER_KIND_SCHEMAS.zoom.options,
])

/** Queries are data for fixed read-only provider endpoints, never URLs or credentials. */
export const nativeSearchQuerySchema = z
  .object({
    provider: liveSearchProviderSchema,
    query: z.string().trim().max(2000),
    accountId: z.string().min(1).max(200).optional(),
    kind: nativeSearchKindSchema.optional(),
    project: z.string().min(1).max(300).optional(),
    browse: z
      .enum(['folder', 'private', 'shared', 'favorites', 'recent'])
      .optional()
      .describe(
        'Queryless discovery: Lucid folder lists one folder page (omit project for root; otherwise use a returned numeric folder ID). Notion private/shared list sidebar pages, favorites lists pinned pages, recent lists recently viewed pages, not recently modified pages. These lists are not an exhaustive workspace inventory. Follow the returned cursor with the same account, browse mode, project, filters and topK.'
      ),
    cursor: z.string().max(4000).optional(),
    termClauses: z.array(z.string().max(500)).max(10).optional(),
    modifiers: z.string().max(1000).optional(),
    keywordOnly: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.kind) {
      const kinds = hasSearchKinds(input.provider) ? PROVIDER_KIND_SCHEMAS[input.provider] : null
      if (!kinds?.safeParse(input.kind).success)
        context.addIssue({
          code: 'custom',
          path: ['kind'],
          message: kinds
            ? `${input.provider} kind must be one of: ${kinds.options.join(', ')}.`
            : `${input.provider} does not support kind selection.`,
        })
    }
    if (
      input.browse &&
      (input.query ||
        input.modifiers ||
        input.keywordOnly ||
        input.termClauses?.length ||
        (input.browse === 'folder' ? input.provider !== 'lucid' : input.provider !== 'notion') ||
        (input.provider === 'notion' && input.project))
    )
      context.addIssue({
        code: 'custom',
        path: ['browse'],
        message:
          'Browse requires an empty query and a supported provider mode; Notion lists cannot be scoped to a page.',
      })
    if (input.browse === 'folder' && input.project && !/^[1-9]\d{0,14}$/.test(input.project))
      context.addIssue({
        code: 'custom',
        path: ['project'],
        message: 'Lucid folder browsing requires a numeric folder ID returned by the provider.',
      })
    if (input.provider === 'lucid' && !input.query && !input.browse)
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Lucid requires title keywords or explicit browse: folder.',
      })
  })
export type NativeSearchQuery = z.output<typeof nativeSearchQuerySchema>

export const nativeSearchQueriesSchema = z
  .array(nativeSearchQuerySchema)
  .min(1)
  .max(9)
  .superRefine((queries, context) => {
    /** A query without an account ID targets every account of its provider. */
    const overlaps = (left: NativeSearchQuery, right: NativeSearchQuery) =>
      left.provider === right.provider &&
      (!left.accountId || !right.accountId || left.accountId === right.accountId)
    /**
     * Queries already bound for the busiest account a new query reaches: every account-wide
     * query, plus the most queries any one targeted account has.
     */
    const busiestAccountLoad = (earlier: NativeSearchQuery[]) => {
      const perAccount = new Map<string, number>()
      for (const { accountId } of earlier)
        if (accountId) perAccount.set(accountId, (perAccount.get(accountId) ?? 0) + 1)
      return (
        earlier.filter(({ accountId }) => !accountId).length + Math.max(0, ...perAccount.values())
      )
    }
    /** The search a query runs, ignoring its account and any kind its provider does not use. */
    const searchKey = ({ accountId: _, kind, ...query }: NativeSearchQuery) =>
      JSON.stringify({ ...query, kind: hasSearchKinds(query.provider) ? kind : undefined })
    for (const [index, query] of queries.entries()) {
      const addIssue = (message: string) =>
        context.addIssue({ code: 'custom', path: [index], message })
      const earlier = queries.slice(0, index).filter((previous) => overlaps(previous, query))
      if (earlier.some((previous) => searchKey(previous) === searchKey(query)))
        addIssue('Duplicate native query.')
      else if (
        hasSearchKinds(query.provider) &&
        earlier.some(
          (previous) => !previous.browse && !query.browse && (!previous.kind || !query.kind)
        )
      )
        addIssue(
          'A GitHub, GitLab, HubSpot, Lucid, Google Meet, or Zoom query without a kind already searches its default kinds; give each query on this account a kind.'
        )
      else if (busiestAccountLoad(earlier) >= MAX_NATIVE_QUERIES_PER_ACCOUNT)
        addIssue(
          `Send at most ${MAX_NATIVE_QUERIES_PER_ACCOUNT} native queries per provider account in one call; queries without an accountId count toward every account of their provider.`
        )
    }
  })

export const liveSearchAccountStatusSchema = z.object({
  accountId: z.string(),
  provider: liveSearchProviderSchema,
  /** Index of the native query in the request that this status and its cursor belong to. */
  queryIndex: z.number().int().min(0).optional(),
  displayName: z.string(),
  status: z.enum(['ok', 'partial', 'reconnect', 'rate_limited', 'unavailable', 'timeout']),
  message: z.string().optional(),
  nextCursor: z.string().optional(),
  folders: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .max(10)
    .optional(),
  retryAfterSeconds: z.number().optional(),
})
export type LiveSearchAccountStatus = z.output<typeof liveSearchAccountStatusSchema>

export const liveSearchCoverageSchema = z.object({
  backend: z.literal('live'),
  accounts: z.array(liveSearchAccountStatusSchema),
  guidance: z.string(),
})

/** Connected-source filters are shared by composer search and Assistant retrieval. */
export const workspaceSearchFiltersSchema = z.object({
  startDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Live search: inclusive lower date bound. For a specific day or bounded date range, always supply endDate too, including exact-title lookups; startDate alone means an open-ended "since" search. Calendar, Google Meet, Zoom, Fireflies and Granola use event or meeting start; Gmail/Slack use message time; other sources use modification time. Include the user’s timezone offset.'
    ),
  endDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Live search: exclusive upper date bound. Include this with startDate whenever the request names a specific day or bounded range, even if the title uniquely identifies a result. For whole days, startDate is local midnight on the first included day and endDate is local midnight after the final included day. Preserve the timezone offset at each boundary.'
    ),
  sortBy: z
    .enum(['relevance', 'newest', 'oldest'])
    .optional()
    .describe(
      'Live search ordering by relevance or the provider date used by startDate/endDate. Date sorting covers retrieved results; inspect partial coverage before claiming latest or earliest overall. Without search terms or dates, newest or oldest lists items up to now.'
    ),
  source: z
    .string()
    .trim()
    .min(1, 'Source cannot be empty')
    .max(100)
    .optional()
    .describe('Connector type or upload source; narrows the selected search scope.'),
  modifiedAfter: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO datetime; restricts results to documents modified after this time.'),
  modifiedBefore: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO datetime; restricts results to documents modified before this time.'),
  documentIds: z
    .array(z.string().min(1).max(4000))
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Document IDs returned by search or selected by the user; narrows retrieval to these documents.'
    ),
})

export const searchWorkspaceInputSchema = workspaceSearchFiltersSchema
  .extend({
    nativeQueries: nativeSearchQueriesSchema
      .optional()
      .describe(
        `Live search only: queries in a provider's own language (Drive q, Gmail operators, JQL, CQL, GitHub qualifiers, Slack RTS, plain Linear/Fireflies/HubSpot/Lucid/Zoom terms, bounded local Google Meet text matching, Granola natural-language questions, Notion keywords or AI questions when available). Blank queries require a date bound, sortBy newest/oldest, or explicit browse mode. Lucid browse folder lists root or a numeric folder project; Notion browse private/shared/favorites/recent lists sidebar pages. Recent means viewed, not modified. Up to ${MAX_NATIVE_QUERIES_PER_ACCOUNT} per account run separately and merge; one GitHub, GitLab, or HubSpot query without a kind searches GitHub issues (plus code when the query has no date bound or boolean operators, as its status message says), GitLab issues, merge requests, and code, or every HubSpot CRM kind; other collections, and multiple content queries on one account, each need a kind, which may repeat; explicit browse queries may select distinct folders or sidebar sections without a kind. HubSpot kinds are contacts, companies, deals, and tickets; Lucid kinds are lucidchart and lucidspark. Google Meet kinds are transcript and smart_notes (note metadata and Docs link only); it searches bounded recent conference artifacts with 30-day retention. Zoom kind is meeting and searches past occurrences; read for transcripts and separately labeled summaries. Use Drive for saved Meet note bodies and older transcripts; Drive dates mean file modification time. HubSpot, Lucid, Zoom and Meet reject ownership filters. Lucid title search has no continuation; folder browsing is paginated and returns child folders in account coverage; project can scope a literal shape-text query to one known document UUID or Lucid URL. Read for structured diagram evidence. Dates and sorting cover only retrieved candidates, not globally newest/oldest matches. Write queries from the returned live guidance and account IDs; each account status names the queryIndex its cursor belongs to. Omit for simple cross-provider terms.`
      ),
    query: z
      .string()
      .trim()
      .max(2000)
      .default('')
      .describe(
        'Search terms, without dates already supplied as filters. May be empty for a live listing with a date bound or sortBy newest or oldest where supported, or use an explicit native browse mode. Notion date-only search depends on plan capabilities.'
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe(
        'Maximum matching passage previews; retrieval ranking is independent of preview length.'
      ),
  })
  .superRefine((input, context) => {
    const bounded = Boolean(
      input.startDate ||
        input.endDate ||
        input.modifiedAfter ||
        input.modifiedBefore ||
        input.sortBy === 'newest' ||
        input.sortBy === 'oldest'
    )
    if (
      !input.query &&
      !input.nativeQueries?.some((query) => query.query || query.browse) &&
      !bounded
    )
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Supply search terms, a native query, a date bound, or sortBy newest or oldest.',
      })
    if (
      input.startDate &&
      input.endDate &&
      Date.parse(input.startDate) >= Date.parse(input.endDate)
    )
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'endDate must be after startDate.',
      })
    if (input.nativeQueries?.some((query) => !query.query && !query.browse) && !bounded)
      context.addIssue({
        code: 'custom',
        path: ['nativeQueries'],
        message: 'Empty native queries require a date bound or sortBy newest or oldest.',
      })
  })

export const readDocumentInputSchema = z.object({
  documentId: z
    .string()
    .min(1)
    .max(4000)
    .describe('Canonical document ID returned by search or selected document context.'),
  /** A larger request is capped rather than refused: the server returns at most 8 chunks anyway. */
  limit: z
    .preprocess(
      (limit) => (typeof limit === 'number' && limit > 8 ? 8 : limit),
      z.number().int().min(1).max(8)
    )
    .default(3)
    .describe(
      'Maximum number of chunks, from 1 to 8 (default 3); the server may return fewer to fit its text budget. Follow next for more context.'
    ),
  startChunkIndex: z
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe(
      'Inclusive chunk index from search or a prior read next object. Disabled chunk gaps are skipped.'
    ),
  startOffset: z
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe(
      'UTF-16 character offset within startChunkIndex. Copy next.startOffset to continue a partial chunk.'
    ),
})

/** Connection requests name a provider and optionally an owned account to repair. */
export const oauthGetAuthLinkInputSchema = z.object({
  providerName: z
    .string()
    .min(1)
    .describe(
      'Integration provider value (for example google-email or slack), or its service display name. Avoid ambiguous base providers such as google.'
    ),
  credentialId: z
    .string()
    .optional()
    .describe(
      'Existing owned credential ID, only when the user requests reconnect or repair. Omit when adding another account.'
    ),
})

/** Organization discovery returns explicit operation targets; it never selects a default workspace. */
export const listWorkspacesInputSchema = z.object({
  workspaceId: z
    .string()
    .uuid()
    .optional()
    .describe('Exact workspace ID to revalidate, when known.'),
  query: z.string().trim().max(200).optional().describe('Case-insensitive workspace name filter.'),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional().describe('Copy nextCursor from the preceding page.'),
})

/** Executor identity belongs to Sim; model-facing profile guidance belongs to its caller. */
export const assistantToolContracts = [
  {
    id: 'list_workspaces',
    route: 'sim',
    description:
      'List currently accessible workspaces with roles and explicit capability restrictions. Bulk results report copilotAllowed and deniedCapabilities; exact workspaceId returns the full capability map. Omitted restrictions never authorize an operation.',
    inputSchema: listWorkspacesInputSchema,
  },
  {
    id: 'search_workspace',
    route: 'sim',
    description: 'Search accessible connected-source passage previews.',
    inputSchema: searchWorkspaceInputSchema,
  },
  {
    id: 'read_document',
    route: 'sim',
    description: 'Read more context from an accessible connected-source document.',
    inputSchema: readDocumentInputSchema,
  },
  {
    id: 'oauth_get_auth_link',
    route: 'sim',
    description: 'Prepare connection guidance for your own account.',
    inputSchema: oauthGetAuthLinkInputSchema,
  },
] as const

/** Bulk discovery reports restrictions explicitly; only exact lookup returns the complete capability map. */
const workspaceCapabilityDetailSchema = z.discriminatedUnion('capabilityDetail', [
  z.object({
    capabilityDetail: z.literal('full'),
    capabilities: z.record(z.string(), z.boolean()),
  }),
  z.object({
    capabilityDetail: z.literal('restrictions'),
    copilotAllowed: z.boolean(),
    deniedCapabilities: z
      .array(z.string())
      .describe(
        'Static capabilities explicitly withheld by current workspace policy. Absence does not grant an operation; use exact workspaceId for the full map.'
      ),
  }),
])

/** Canonical organization discovery; authorized exact-target recall may include stored notes. */
export const listWorkspacesResultSchema = z.object({
  success: z.literal(true),
  workspaces: z.array(
    z
      .object({ id: z.uuid(), name: z.string(), role: z.enum(['read', 'write', 'admin']) })
      .and(workspaceCapabilityDetailSchema)
  ),
  nextCursor: z.uuid().nullable(),
  storedNotes: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['user_pref', 'workspace_fact']),
        content: z.string(),
        updatedAt: z.iso.datetime(),
      })
    )
    .optional(),
})

/** One document a workspace search matched, with the best chunk of it. */
export const workspaceKnowledgeSearchResultSchema = z.object({
  documentId: z.string(),
  knowledgeBaseId: z.string(),
  knowledgeBaseName: z.string(),
  documentName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  connectorType: z.string().nullable(),
  sourceModifiedAt: z.string().nullable(),
  sourceDate: z.string().nullable().optional(),
  sourceContainerName: z.string().optional(),
  sourceContainerUrl: z.string().optional(),
  sourceDateType: z.enum(['event_start', 'message', 'modified']).optional(),
  /** The person behind the document, from its author-like tag; null when the source names none. */
  author: z.string().nullable(),
  content: z.string(),
  chunkIndex: z.number(),
  similarity: z.number(),
})
export type WorkspaceKnowledgeSearchResult = z.output<typeof workspaceKnowledgeSearchResultSchema>

export const workspaceKnowledgeSearchDataSchema = z.object({
  live: liveSearchCoverageSchema.optional(),
  query: z.string(),
  results: z.array(workspaceKnowledgeSearchResultSchema),
  retrieval: z.object({
    status: z.enum(['complete', 'partial']),
    timedOutLegs: z.array(z.enum(['vector', 'keyword', 'tags'])).max(3),
  }),
})
export type WorkspaceKnowledgeSearchData = z.output<typeof workspaceKnowledgeSearchDataSchema>
