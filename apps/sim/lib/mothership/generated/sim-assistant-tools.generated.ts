// GENERATED — do not edit. Source: Sim apps/sim/lib/api/contracts/mothership-assistant-tools.ts
// Regenerate with `bun run generate:cli-inventory` in the worker.

import { z } from 'zod'

/** Connected-source filters are shared by composer search and Assistant retrieval. */
export const workspaceSearchFiltersSchema = z.object({
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
  documentIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Document IDs returned by search or selected by the user; narrows retrieval to these documents.'
    ),
})

export const searchWorkspaceInputSchema = workspaceSearchFiltersSchema.extend({
  query: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('Search query describing the information needed.'),
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

export const readDocumentInputSchema = z.object({
  documentId: z
    .string()
    .min(1)
    .max(200)
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
  /** The person behind the document, from its author-like tag; null when the source names none. */
  author: z.string().nullable(),
  content: z.string(),
  chunkIndex: z.number(),
  similarity: z.number(),
})
export type WorkspaceKnowledgeSearchResult = z.output<typeof workspaceKnowledgeSearchResultSchema>

export const workspaceKnowledgeSearchDataSchema = z.object({
  query: z.string(),
  results: z.array(workspaceKnowledgeSearchResultSchema),
  retrieval: z.object({
    status: z.enum(['complete', 'partial']),
    timedOutLegs: z.array(z.enum(['vector', 'keyword', 'tags'])).max(3),
  }),
})
export type WorkspaceKnowledgeSearchData = z.output<typeof workspaceKnowledgeSearchDataSchema>
