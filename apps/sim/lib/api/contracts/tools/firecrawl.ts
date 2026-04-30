import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const firecrawlParseResponseSchema = z.object({}).passthrough()

export const firecrawlParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  file: RawFileInputSchema,
  options: z.record(z.string(), z.unknown()).optional(),
})

export const firecrawlParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/firecrawl/parse',
  body: firecrawlParseBodySchema,
  response: { mode: 'json', schema: firecrawlParseResponseSchema },
})

export type FirecrawlParseBody = ContractBody<typeof firecrawlParseContract>
export type FirecrawlParseBodyInput = ContractBodyInput<typeof firecrawlParseContract>
export type FirecrawlParseResponse = ContractJsonResponse<typeof firecrawlParseContract>
