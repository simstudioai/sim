import { z } from 'zod'
import { LIVE_SEARCH_PROVIDER_IDS } from '@/lib/sim-search/live/provider-catalog'

export const liveSearchProviderSchema = z.enum(LIVE_SEARCH_PROVIDER_IDS)
export type LiveSearchProvider = z.output<typeof liveSearchProviderSchema>

/**
 * Native queries one call may send to the same provider account. Alternatives run as separate
 * provider searches and fuse into one ranking, so the bound keeps a call within the provider's
 * burst limits (Slack allows about ten searches per user per minute) while leaving room for the
 * four GitHub or GitLab kinds.
 */
export const MAX_NATIVE_QUERIES_PER_ACCOUNT = 4

/**
 * Providers whose `kind` selects a separate search endpoint. They take one query per kind: their
 * query languages already join alternatives with OR, and each extra query fans out into several
 * repository or project requests against strict search rate limits.
 */
const KIND_PROVIDERS: ReadonlySet<LiveSearchProvider> = new Set(['github', 'gitlab'])

const nativeSearchKindSchema = z.enum([
  'issues',
  'code',
  'repositories',
  'commits',
  'merge_requests',
  'wiki',
])

/** Queries are data for fixed read-only provider endpoints, never URLs or credentials. */
export const nativeSearchQuerySchema = z
  .object({
    provider: liveSearchProviderSchema,
    query: z.string().trim().max(2000),
    accountId: z.string().min(1).max(200).optional(),
    kind: nativeSearchKindSchema.optional(),
    project: z.string().min(1).max(300).optional(),
    cursor: z.string().max(4000).optional(),
    termClauses: z.array(z.string().max(500)).max(10).optional(),
    modifiers: z.string().max(1000).optional(),
    keywordOnly: z.boolean().optional(),
  })
  .strict()
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
    /** The search a query runs, ignoring its account and any kind its provider does not use. */
    const searchKey = ({ accountId: _, kind, ...query }: NativeSearchQuery) =>
      JSON.stringify({ ...query, kind: KIND_PROVIDERS.has(query.provider) ? kind : undefined })
    for (const [index, query] of queries.entries()) {
      const addIssue = (message: string) =>
        context.addIssue({ code: 'custom', path: [index], message })
      const earlier = queries.slice(0, index).filter((previous) => overlaps(previous, query))
      if (earlier.some((previous) => searchKey(previous) === searchKey(query)))
        addIssue('Duplicate native query.')
      else if (
        KIND_PROVIDERS.has(query.provider) &&
        earlier.some((previous) => !previous.kind || !query.kind || previous.kind === query.kind)
      )
        addIssue(
          'Send one GitHub or GitLab query per account and kind; join alternatives with OR in one query (GitHub code search has no OR, so search code alternatives in another call).'
        )
      else if (earlier.length >= MAX_NATIVE_QUERIES_PER_ACCOUNT)
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
      'Live search: inclusive lower date bound. Calendar uses scheduled event start; Gmail/Slack use message time; other sources use modification time. Include the user’s timezone offset.'
    ),
  endDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Live search: exclusive upper bound on the same date as startDate. For a whole day, use the next local midnight.'
    ),
  sortBy: z
    .enum(['relevance', 'newest', 'oldest'])
    .optional()
    .describe(
      'Live search ordering by relevance or the provider date used by startDate/endDate. Date sorting covers retrieved results; inspect partial coverage before claiming latest or earliest overall.'
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
        `Live search only: queries in a provider's own language (Drive q, Gmail operators, JQL, CQL, GitHub qualifiers, Slack RTS). Up to ${MAX_NATIVE_QUERIES_PER_ACCOUNT} per account run separately and merge; GitHub and GitLab take one per kind. Write them from the returned live guidance and account IDs; each account status names the queryIndex its cursor belongs to. Omit for simple cross-provider terms.`
      ),
    query: z
      .string()
      .trim()
      .max(2000)
      .default('')
      .describe(
        'Search terms, without dates already supplied as filters. May be empty for a live date-bounded listing.'
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
    if (
      !input.query &&
      !input.nativeQueries?.some((query) => query.query) &&
      !input.startDate &&
      !input.endDate &&
      !input.modifiedAfter &&
      !input.modifiedBefore
    )
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Supply search terms, a native query, or a date bound.',
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
    if (
      input.nativeQueries?.some((query) => !query.query) &&
      !input.startDate &&
      !input.endDate &&
      !input.modifiedAfter &&
      !input.modifiedBefore
    )
      context.addIssue({
        code: 'custom',
        path: ['nativeQueries'],
        message: 'Empty native queries require a date bound.',
      })
  })

export const readDocumentInputSchema = z.object({
  documentId: z
    .string()
    .min(1)
    .max(4000)
    .describe('Canonical document ID returned by search or selected document context.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(8)
    .default(3)
    .describe(
      'Maximum chunks; the server may return fewer to fit its text budget. Follow next for more context.'
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
