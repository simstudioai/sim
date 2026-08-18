import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const SECRET_USAGE_DEFAULT_LIMIT = 100
const SECRET_USAGE_MAX_LIMIT = 500

export const secretUsageScopeSchema = z.enum(['workspace', 'personal'])

export const secretUsageQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  name: z.string().min(1, 'Secret name is required'),
  scope: secretUsageScopeSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be at least 1')
    .max(SECRET_USAGE_MAX_LIMIT, `limit cannot exceed ${SECRET_USAGE_MAX_LIMIT}`)
    .default(SECRET_USAGE_DEFAULT_LIMIT),
})

export const secretUsageEntrySchema = z.object({
  id: z.string(),
  /** UTC day bucket, `YYYY-MM-DD`. */
  usageDate: z.string(),
  useCount: z.number().int().nonnegative(),
  firstUsedAt: z.string(),
  lastUsedAt: z.string(),
  source: z.enum(['workflow', 'copilot', 'mcp']),
  workflowId: z.string().nullable(),
  workflowName: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  lastExecutionId: z.string().nullable(),
  lastTrigger: z.string().nullable(),
})

export const getSecretUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/secrets/usage',
  query: secretUsageQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      entries: z.array(secretUsageEntrySchema),
    }),
  },
})

export type SecretUsageScope = z.output<typeof secretUsageScopeSchema>
export type SecretUsageQuery = z.input<typeof secretUsageQuerySchema>
export type SecretUsageEntryPayload = z.output<typeof secretUsageEntrySchema>
