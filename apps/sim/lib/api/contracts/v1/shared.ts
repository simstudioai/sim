import { z } from 'zod'

/**
 * Rate-limit / usage envelope injected into every Family-A v1 response by
 * `createApiResponse` (see `app/api/v1/logs/meta.ts`). Mirrors the `UserLimits`
 * interface in that file. Shared here so logs, audit-logs, and workflows
 * contracts describe `limits` identically instead of each redefining it.
 */
export const v1UserLimitsSchema = z.object({
  workflowExecutionRateLimit: z.object({
    sync: z.object({
      requestsPerMinute: z.number(),
      maxBurst: z.number(),
      remaining: z.number(),
      resetAt: z.string(),
    }),
    async: z.object({
      requestsPerMinute: z.number(),
      maxBurst: z.number(),
      remaining: z.number(),
      resetAt: z.string(),
    }),
  }),
  usage: z.object({
    currentPeriodCost: z.number(),
    limit: z.number(),
    plan: z.string(),
    isExceeded: z.boolean(),
  }),
})

export type V1UserLimits = z.output<typeof v1UserLimitsSchema>

/**
 * Family-A envelope helper: `{ data, limits }`. Use for the `createApiResponse`
 * detail/action surfaces (logs/[id], workflows deploy/rollback/undeploy). List
 * endpoints that also return a `nextCursor` should compose the object directly
 * (`{ data, nextCursor: z.string().optional(), limits: v1UserLimitsSchema }`).
 */
export const withV1Limits = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    limits: v1UserLimitsSchema,
  })
