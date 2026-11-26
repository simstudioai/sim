import { z } from 'zod'
import {
  liveSearchInvolvingSchema,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
import { mcpJsonRpcMessageSchema } from '@/lib/api/contracts/mcp'
import {
  readDocumentInputSchema,
  refineSearchWorkspaceInput,
  searchWorkspaceInputFieldsSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  PEOPLE_ID_MAX_LENGTH,
  PEOPLE_SEARCH_MAX_LENGTH,
  PEOPLE_SEARCH_MAX_TERMS,
} from '@/lib/people/validation'

export const organizationKnowledgeMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/search/organizations/[organizationId]',
  params: z.object({ organizationId: organizationIdSchema }),
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})

const LIVE_SEARCH_MCP_DEFAULT_TOP_K = { federated: 30, scoped: 20 } as const

const HAS_UTC_OFFSET = /(Z|[+-]\d{2}:\d{2})$/

/**
 * An ISO datetime filter that reads a value without an offset as UTC, which is what a client
 * resends after that value is rejected, so the call succeeds on the first try. Its JSON Schema
 * keeps `format: "date-time"` and the field's description but not the regex, which every
 * tools/list call would resend.
 */
function mcpDateFilter(field: z.ZodOptional<z.ZodString>) {
  return z.iso
    .datetime({ offset: true, local: true })
    .transform((value) => (HAS_UTC_OFFSET.test(value) ? value : `${value}Z`))
    .optional()
    .meta({ pattern: undefined, description: field.description })
}

const { startDate, endDate, modifiedAfter, modifiedBefore } = workspaceSearchFiltersSchema.shape

/** The date filters of the Search MCP tools, as their tools/list schema presents them. */
const mcpDateFilterFields = {
  startDate: mcpDateFilter(startDate),
  endDate: mcpDateFilter(endDate),
  modifiedAfter: mcpDateFilter(modifiedAfter),
  modifiedBefore: mcpDateFilter(modifiedBefore),
}

export const liveSearchMcpSchema = searchWorkspaceInputFieldsSchema
  .extend({
    ...mcpDateFilterFields,
    involving: liveSearchInvolvingSchema
      .optional()
      .describe(
        'Only items this person took part in: "me" (you) or a colleague\'s email. Each source applies its own meaning (sent, authored, owns, assigned, attended) and sources that cannot filter by person are skipped. Use for activity questions such as what someone worked on or what is assigned to them; with an empty query and a date range it lists that person\'s activity.'
      ),
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

const mcpDocumentIdSchema = readDocumentInputSchema.shape.documentId.describe(
  'A document ID returned by search, or a link to the document in its source.'
)

export const readLiveDocumentMcpSchema = readDocumentInputSchema
  .extend({
    documentId: mcpDocumentIdSchema.optional(),
    startChunkIndex: readDocumentInputSchema.shape.startChunkIndex.describe(
      'Copy next.startChunkIndex from a prior read to continue it; live documents always use 0.'
    ),
    documentIds: z
      .array(mcpDocumentIdSchema)
      .min(1)
      .max(MAX_MCP_READ_DOCUMENTS)
      .optional()
      .describe(
        `Up to ${MAX_MCP_READ_DOCUMENTS} document IDs or links, read together from the beginning. Use instead of documentId.`
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
    chatId: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('The chatId of an earlier chat answer, to ask a follow-up in that conversation.'),
  })
  .strict()

export const searchPeopleMcpSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(PEOPLE_SEARCH_MAX_LENGTH)
      .optional()
      .describe(
        `Up to ${PEOPLE_SEARCH_MAX_TERMS} words from a name, email, title, department, or location; a person matches when every word appears in one of them.`
      ),
    personId: z
      .string()
      .min(1)
      .max(PEOPLE_ID_MAX_LENGTH)
      .optional()
      .describe(
        'A personId from an earlier result, to show that person with their managers and direct reports. Used instead of query.'
      ),
    cursor: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe('nextCursor from the previous page of the same query.'),
  })
  .strict()
  .refine((input) => !input.personId || (input.query === undefined && !input.cursor), {
    path: ['personId'],
    message: 'Pass either personId or a query with its cursor, not both.',
  })
