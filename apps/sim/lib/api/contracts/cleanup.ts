import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  type CleanupLimits,
  type CleanupType,
  LOG_CLEANUP_TYPES,
  SOFT_DELETE_CLEANUP_TYPES,
} from '@/lib/cleanup/limits'

const limitSchema = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().min(0).max(5000))
function cleanupQuerySchema(types: readonly CleanupType[]) {
  return z
    .object(Object.fromEntries(types.map((type) => [type, limitSchema.optional()])))
    .strict()
    .transform((query, ctx): CleanupLimits | undefined => {
      if (Object.keys(query).length === 0) return undefined
      if (!Object.values(query).some((limit) => limit !== undefined && limit > 0)) {
        ctx.addIssue({ code: 'custom', message: 'At least one positive cleanup limit is required' })
        return z.NEVER
      }
      return query
    })
}
export const logsCleanupQuerySchema = cleanupQuerySchema(LOG_CLEANUP_TYPES)
export const softDeletesCleanupQuerySchema = cleanupQuerySchema(SOFT_DELETE_CLEANUP_TYPES)
const responseSchema = z.union([
  z.object({
    triggered: z.literal(true),
    jobIds: z.array(z.string()),
    jobCount: z.number(),
    chunkCount: z.number(),
    workspaceCount: z.number(),
  }),
  z.object({
    triggered: z.literal(true),
    runId: z.string(),
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
  response: { mode: 'json', schema: responseSchema, status: [200, 202] },
})
export const softDeletesCleanupContract = defineRouteContract({
  method: 'GET',
  path: '/api/cron/cleanup-soft-deletes',
  query: softDeletesCleanupQuerySchema,
  response: { mode: 'json', schema: responseSchema, status: [200, 202] },
})

/** Apply the same bounds to direct task submissions as HTTP requests. */
export function validateCleanupLimits(
  jobType: 'cleanup-logs' | 'cleanup-soft-deletes',
  limits: CleanupLimits
): CleanupLimits {
  const parsed = (
    jobType === 'cleanup-logs' ? logsCleanupQuerySchema : softDeletesCleanupQuerySchema
  ).parse(limits)
  if (!parsed) throw new Error('Cleanup limits are required')
  return parsed
}
