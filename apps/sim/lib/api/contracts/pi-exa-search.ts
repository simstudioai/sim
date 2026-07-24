import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const piExaSearchBodySchema = z.object({
  query: z.string().trim().min(1, 'Query is required').max(512, 'Query is too long'),
  numResults: z.number().int().min(1).max(10).default(5),
})

export const piExaSearchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string(),
  publishedDate: z.string().optional(),
})

export const piExaSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/pi/exa-search',
  body: piExaSearchBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      results: z.array(piExaSearchResultSchema).max(10),
    }),
  },
})

export type PiExaSearchBody = z.input<typeof piExaSearchBodySchema>
