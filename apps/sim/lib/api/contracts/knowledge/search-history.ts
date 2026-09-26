import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { SEARCH_HISTORY_LIMIT } from '@/lib/knowledge/search/history/limits'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/source-url'

export const searchHistoryParamsSchema = z.object({ id: organizationIdSchema })
export const viewedSearchSourceSchema = z.object({
  url: z
    .string()
    .max(4096)
    .refine(isKnowledgeSourceUrl, 'Source URL must be HTTP(S) without credentials'),
  title: z.string().trim().min(1).max(512).optional(),
  siteName: z.string().trim().min(1).max(128).optional(),
  connectorType: z.string().trim().min(1).max(64).optional(),
})
export const recordSearchSourceSchema = viewedSearchSourceSchema.pick({ url: true })
export type ViewedSearchSource = z.output<typeof recordSearchSourceSchema>

export const recordSearchHistoryBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), source: recordSearchSourceSchema }),
  z.object({
    kind: z.literal('query'),
    query: z.string().trim().min(1, 'Search query is required').max(4000),
  }),
])
export type RecordSearchHistoryBody = z.input<typeof recordSearchHistoryBodySchema>

export const searchHistoryResponseSchema = z.object({
  sources: z
    .array(viewedSearchSourceSchema.extend({ viewedAt: z.iso.datetime() }))
    .max(SEARCH_HISTORY_LIMIT),
  queries: z
    .array(z.object({ query: z.string().min(1).max(4000), searchedAt: z.iso.datetime() }))
    .max(SEARCH_HISTORY_LIMIT),
})
export type SearchHistoryResponse = z.output<typeof searchHistoryResponseSchema>

export const listSearchHistoryContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/search/history',
  params: searchHistoryParamsSchema,
  response: { mode: 'json', schema: searchHistoryResponseSchema },
})
export const recordSearchHistoryContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/search/history',
  params: searchHistoryParamsSchema,
  body: recordSearchHistoryBodySchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
export const clearSearchHistoryContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/search/history',
  params: searchHistoryParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
