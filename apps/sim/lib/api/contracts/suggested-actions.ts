import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** One prompt a suggestion can start, from the block template catalog or a table starter. */
const suggestedActionCandidateSchema = z.object({
  id: z.string().min(1).max(200),
  /** At most one suggestion per block, and the block whose icon the row shows. */
  blockType: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  prompt: z.string().min(1).max(10_000),
  modules: z.array(z.string().max(100)).max(20),
  featured: z.boolean(),
  popular: z.boolean(),
  /** The OAuth service the block connects through, which connectivity weighs. */
  providerId: z.string().max(200).nullable(),
  /** A table starter, which has no block of its own. */
  starter: z.boolean(),
})
export type SuggestedActionCandidate = z.output<typeof suggestedActionCandidateSchema>

export const getSuggestedActionCatalogContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/suggested-actions',
  response: {
    mode: 'json',
    schema: z.object({
      candidates: z.array(suggestedActionCandidateSchema).max(10_000),
      /** How many catalog templates each OAuth service has, the popularity a connect row weighs. */
      templateCounts: z.record(z.string(), z.number().int().min(0)),
    }),
  },
})
export type SuggestedActionCatalog = z.output<
  typeof getSuggestedActionCatalogContract.response.schema
>
