import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const searchResultSchema = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string(),
  date: z.string().optional(),
  position: z.number(),
})

const searchCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  total: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number(),
  }),
  model: z.string(),
  pricing: z.object({
    input: z.number(),
    cachedInput: z.number(),
    output: z.number(),
    updatedAt: z.string(),
  }),
})

export const searchToolResponseSchema = z.object({
  results: z.array(searchResultSchema),
  query: z.string(),
  totalResults: z.number(),
  source: z.literal('exa'),
  cost: searchCostSchema,
})

export const searchToolBodySchema = z.object({
  query: z.string().min(1),
})

export const searchToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/search',
  body: searchToolBodySchema,
  response: { mode: 'json', schema: searchToolResponseSchema },
})

export type SearchToolBody = ContractBody<typeof searchToolContract>
export type SearchToolBodyInput = ContractBodyInput<typeof searchToolContract>
export type SearchToolResponse = ContractJsonResponse<typeof searchToolContract>
