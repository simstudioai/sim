import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  type BoundedCleanupOptions,
  type CleanupType,
  LOG_CLEANUP_TYPES,
  SOFT_DELETE_CLEANUP_TYPES,
} from '@/lib/cleanup/bounded-types'

const integerQuery = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max))

function cleanupQuerySchema(types: readonly CleanupType[]) {
  const limits = Object.fromEntries(types.map((type) => [type, integerQuery(0, 5000).optional()]))
  return z
    .object({
      ...limits,
      batchSize: integerQuery(1, 500).optional(),
      dryRun: z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .optional(),
      requestId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .optional(),
    })
    .strict()
    .transform((query, ctx): BoundedCleanupOptions | undefined => {
      if (Object.keys(query).length === 0) return undefined
      const budgets: BoundedCleanupOptions['limits'] = {}
      for (const type of types)
        budgets[type] = (query as Partial<Record<CleanupType, number>>)[type] ?? 0
      if (!Object.values(budgets).some((limit) => limit > 0)) {
        ctx.addIssue({ code: 'custom', message: 'At least one positive cleanup limit is required' })
        return z.NEVER
      }
      if (!query.requestId) {
        ctx.addIssue({
          code: 'custom',
          path: ['requestId'],
          message: 'requestId is required for bounded cleanup',
        })
        return z.NEVER
      }
      return {
        limits: budgets,
        batchSize: query.batchSize ?? 25,
        dryRun: query.dryRun ?? false,
        requestId: query.requestId,
      }
    })
}
export const logsCleanupQuerySchema = cleanupQuerySchema(LOG_CLEANUP_TYPES)
export const softDeletesCleanupQuerySchema = cleanupQuerySchema(SOFT_DELETE_CLEANUP_TYPES)
const cleanupResponseSchema = z.union([
  z.object({
    triggered: z.literal(true),
    jobIds: z.array(z.string()),
    jobCount: z.number(),
    chunkCount: z.number(),
    workspaceCount: z.number(),
  }),
  z.object({
    triggered: z.literal(true),
    mode: z.literal('bounded'),
    runId: z.string(),
    requestId: z.string(),
    batchSize: z.number().int(),
    dryRun: z.boolean(),
    limits: z.partialRecord(
      z.enum([...LOG_CLEANUP_TYPES, ...SOFT_DELETE_CLEANUP_TYPES]),
      z.number().int().min(0).max(5000)
    ),
  }),
])
export const logsCleanupContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs/cleanup',
  query: logsCleanupQuerySchema,
  response: { mode: 'json', schema: cleanupResponseSchema, status: [200, 202] },
})
export const softDeletesCleanupContract = defineRouteContract({
  method: 'GET',
  path: '/api/cron/cleanup-soft-deletes',
  query: softDeletesCleanupQuerySchema,
  response: { mode: 'json', schema: cleanupResponseSchema, status: [200, 202] },
})

/** Validate direct Trigger invocations as well as HTTP calls. */
export function validateBoundedCleanupOptions(
  options: BoundedCleanupOptions,
  types: readonly CleanupType[]
) {
  return cleanupQuerySchema(types).parse({
    ...Object.fromEntries(
      Object.entries(options.limits).map(([key, value]) => [key, String(value)])
    ),
    batchSize: String(options.batchSize),
    dryRun: String(options.dryRun),
    requestId: options.requestId,
  })!
}
