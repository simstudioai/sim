import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const searchToolResponseSchema = z.object({}).passthrough()

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
