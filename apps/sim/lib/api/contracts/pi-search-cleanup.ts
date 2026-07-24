import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const cleanupPiSearchCapabilitiesContract = defineRouteContract({
  method: 'GET',
  path: '/api/cron/cleanup-pi-search-capabilities',
  response: {
    mode: 'json',
    schema: z.union([
      z.object({ success: z.literal(true), skipped: z.literal(true) }),
      z.object({ success: z.literal(true), deleted: z.number().int().min(0) }),
      z.object({ success: z.literal(false), error: z.string() }),
    ]),
  },
})
