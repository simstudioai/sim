import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const runEnrichmentBodySchema = z.object({
  enrichmentId: z.string().min(1, 'enrichmentId is required'),
  /** Per-enrichment input map: enrichment input id → mapped value. */
  inputs: z.record(z.string(), z.unknown()).default({}),
  workspaceId: z.string().min(1, 'workspaceId is required'),
})

const runEnrichmentResponseSchema = z.object({
  matched: z.boolean(),
  // untyped-response: per-enrichment output map — keys and value types vary by enrichment
  result: z.record(z.string(), z.unknown()),
  cost: z.number(),
  error: z.string().nullable(),
  /** Label of the provider whose result was returned, null on no match. */
  provider: z.string().nullable(),
})

export const runEnrichmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/enrichment/run',
  body: runEnrichmentBodySchema,
  response: { mode: 'json', schema: runEnrichmentResponseSchema },
})

export type RunEnrichmentBody = z.input<typeof runEnrichmentBodySchema>
export type RunEnrichmentResponse = z.output<typeof runEnrichmentResponseSchema>
