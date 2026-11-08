import { z } from 'zod'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import { mcpJsonRpcMessageSchema } from '@/lib/api/contracts/mcp'
import {
  readDocumentInputSchema,
  refineSearchWorkspaceInput,
  searchWorkspaceInputFieldsSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const organizationKnowledgeMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/search/organizations/[organizationId]',
  params: z.object({ organizationId: organizationIdSchema }),
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})

const LIVE_SEARCH_MCP_DEFAULT_TOP_K = { federated: 30, scoped: 20 } as const

/**
 * A datetime field without the regex its JSON Schema would otherwise carry beside
 * `format: "date-time"`. Every tools/list call resends the schema, and parsing still rejects a
 * string that is not an ISO datetime with an offset.
 */
function withoutPatternInJsonSchema<T extends z.ZodType>(schema: T): T {
  return schema.meta({ pattern: undefined })
}

const { startDate, endDate, modifiedAfter, modifiedBefore } = workspaceSearchFiltersSchema.shape

/** The date filters of the Search MCP tools, as their tools/list schema presents them. */
const mcpDateFilterFields = {
  startDate: withoutPatternInJsonSchema(startDate),
  endDate: withoutPatternInJsonSchema(endDate),
  modifiedAfter: withoutPatternInJsonSchema(modifiedAfter),
  modifiedBefore: withoutPatternInJsonSchema(modifiedBefore),
}

export const liveSearchMcpSchema = searchWorkspaceInputFieldsSchema
  .extend({
    ...mcpDateFilterFields,
    topK: searchWorkspaceInputFieldsSchema.shape.topK
      .unwrap()
      .optional()
      .describe(
        `Maximum matching passage previews: ${LIVE_SEARCH_MCP_DEFAULT_TOP_K.federated} by default for a query across every source, otherwise ${LIVE_SEARCH_MCP_DEFAULT_TOP_K.scoped}. Retrieval ranking is independent of preview length.`
      ),
  })
  .strict()
  .superRefine(refineSearchWorkspaceInput)

/**
 * Previews a search returns when the caller sets no topK. A query across every source shares one
 * list among all of them, so it gets more room than a search of one source, a native query, or a
 * sorted listing.
 */
export function liveSearchMcpDefaultTopK(input: z.output<typeof liveSearchMcpSchema>): number {
  return input.query &&
    !input.source &&
    !input.nativeQueries &&
    (!input.sortBy || input.sortBy === 'relevance')
    ? LIVE_SEARCH_MCP_DEFAULT_TOP_K.federated
    : LIVE_SEARCH_MCP_DEFAULT_TOP_K.scoped
}

/** Documents one read_document call may read; each counts as one read against the rate limit. */
const MAX_MCP_READ_DOCUMENTS = 10

export const readLiveDocumentMcpSchema = readDocumentInputSchema
  .extend({
    documentId: readDocumentInputSchema.shape.documentId.optional(),
    documentIds: z
      .array(readDocumentInputSchema.shape.documentId)
      .min(1)
      .max(MAX_MCP_READ_DOCUMENTS)
      .optional()
      .describe(
        `Up to ${MAX_MCP_READ_DOCUMENTS} document IDs returned by search, read together from the beginning. Use instead of documentId.`
      ),
  })
  .strict()
  .superRefine((input, context) => {
    if (Boolean(input.documentId) === Boolean(input.documentIds))
      context.addIssue({
        code: 'custom',
        path: ['documentId'],
        message: 'Pass either documentId or documentIds.',
      })
    if (
      input.documentIds &&
      (input.startChunkIndex !== undefined || input.startOffset !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['documentIds'],
        message: 'Continue a document with documentId and its next offsets, not documentIds.',
      })
  })

export const chatSearchMcpSchema = workspaceSearchFiltersSchema
  .extend({
    ...mcpDateFilterFields,
    query: z.string().trim().min(1, 'A question is required').max(8192),
  })
  .strict()
