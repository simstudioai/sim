import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const healthQuerySchema = z.object({}).passthrough()
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
  version: z.string(),
  commit: z.string().nullable(),
})

export type HealthResponse = z.output<typeof healthResponseSchema>

export const healthContract = defineRouteContract({
  method: 'GET',
  path: '/api/health',
  query: healthQuerySchema,
  response: {
    mode: 'json',
    schema: healthResponseSchema,
  },
})
