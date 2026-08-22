import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const storageUsageSchema = z
  .object({
    usedBytes: z.number(),
    limitBytes: z.number(),
    percentUsed: z.number(),
  })
  .strict()

export const usageLimitRateStatusSchema = z
  .object({
    isLimited: z.boolean(),
    requestsPerMinute: z.number(),
    maxBurst: z.number(),
    remaining: z.number(),
    resetAt: z.string().datetime(),
  })
  .strict()

export const usageLimitsResponseSchema = z
  .object({
    success: z.literal(true),
    rateLimit: z
      .object({
        sync: usageLimitRateStatusSchema,
        async: usageLimitRateStatusSchema,
        authType: z.enum(['api', 'manual']),
      })
      .strict(),
    usage: z
      .object({
        currentPeriodCost: z.number(),
        limit: z.number(),
        plan: z.string(),
      })
      .strict(),
    storage: storageUsageSchema,
  })
  .strict()

export const usageLimitsRequestSchema = z.object({}).strict()

export type UsageLimitsResponse = z.output<typeof usageLimitsResponseSchema>

export const getUsageLimitsContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/usage-limits',
  response: {
    mode: 'json',
    schema: usageLimitsResponseSchema,
  },
})
