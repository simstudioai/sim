import { z } from 'zod'

export const MAX_LISTING_FAILURE_SAMPLES = 10

/** Persist only bounded scope identifiers and provider-owned codes, never raw errors or content. */
export const listingFailuresSchema = z.object({
  count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  samples: z
    .array(
      z.object({
        scope: z.string().min(1).max(254),
        operation: z.string().min(1).max(96),
        status: z.number().int().min(100).max(599).optional(),
        reasons: z.array(z.string().min(1).max(64)).max(16),
      })
    )
    .max(MAX_LISTING_FAILURE_SAMPLES),
})
