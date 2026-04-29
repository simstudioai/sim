import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const storageUsageSchema = z.object({
  usedBytes: z.number(),
  limitBytes: z.number(),
  percentUsed: z.number(),
})

export const usageLimitsRequestSchema = z.object({}).strict()

export const getUsageLimitsContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/usage-limits',
  response: {
    mode: 'json',
    schema: z
      .object({
        success: z.boolean(),
        usage: z
          .object({
            plan: z.string().optional(),
          })
          .passthrough()
          .optional(),
        storage: storageUsageSchema,
      })
      .passthrough(),
  },
})
