import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

const paginationValueSchema = (defaultValue: number, maxValue: number) =>
  z.preprocess(lastQueryValue, z.union([z.string(), z.number()]).optional()).transform((value) => {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return defaultValue
    return Math.min(parsed, maxValue)
  })

export const newsletterRunIdParamsSchema = z.object({
  id: z.string({ error: 'Newsletter run id is required' }).min(1, 'Newsletter run id is required'),
})

export const newsletterRunStatusSchema = z.enum([
  'draft',
  'finalizing',
  'finalized',
  'oversized',
  'pushing',
  'pushed',
  'failed',
])

export const newsletterRecipientSyncStatusSchema = z.enum([
  'pending',
  'created',
  'updated',
  'segment_added',
  'excluded',
  'failed',
])

export const newsletterTargetingCriteriaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('everyone'),
  }),
  z.object({
    type: z.literal('integration_users'),
    integration: z.string().min(1),
    timeWindowDays: z.number().int().min(1).max(3650).nullable(),
  }),
  z.object({
    type: z.literal('chat_mentions'),
    term: z.string().min(1).max(80),
    timeWindowDays: z.number().int().min(1).max(365),
  }),
  z.object({
    type: z.literal('recently_active'),
    timeWindowDays: z.number().int().min(1).max(3650),
  }),
])

export const newsletterRecipientSampleSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  reason: z.string(),
})

export const newsletterCountsSchema = z.object({
  totalMatched: z.number(),
  excludedBanned: z.number(),
  excludedUnverified: z.number(),
  excludedUnsubscribed: z.number(),
  excludedSuppressed: z.number(),
  finalRecipientCount: z.number(),
})

export const newsletterRunSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  criteria: newsletterTargetingCriteriaSchema,
  status: newsletterRunStatusSchema,
  counts: newsletterCountsSchema,
  sampleRecipients: z.array(newsletterRecipientSampleSchema),
  resendSegmentId: z.string().nullable(),
  resendSegmentName: z.string().nullable(),
  resendSyncedAt: z.string().nullable(),
  resendSyncJobId: z.string().nullable(),
  error: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createNewsletterRunBodySchema = z.object({
  name: z.string({ error: 'Name is required' }).min(1, 'Name is required').max(120),
  prompt: z.string({ error: 'Prompt is required' }).min(1, 'Prompt is required').max(1000),
})

export const listNewsletterRunsQuerySchema = z.object({
  limit: paginationValueSchema(25, 100),
  offset: paginationValueSchema(0, 100000),
})

export const listNewsletterRunsResponseSchema = z.object({
  runs: z.array(newsletterRunSchema),
  total: z.number(),
})

export const newsletterRunResponseSchema = z.object({
  run: newsletterRunSchema,
})

export const pushNewsletterRunResponseSchema = z.object({
  run: newsletterRunSchema,
  jobId: z.string(),
})

export const newsletterJobResponseSchema = z.object({
  job: z
    .object({
      id: z.string(),
      status: z.enum(['pending', 'processing', 'completed', 'failed']),
      attempts: z.number(),
      maxAttempts: z.number(),
      error: z.string().nullable(),
      createdAt: z.string(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
    })
    .nullable(),
})

export const listNewsletterRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/superuser/newsletters/runs',
  query: listNewsletterRunsQuerySchema,
  response: {
    mode: 'json',
    schema: listNewsletterRunsResponseSchema,
  },
})

export const createNewsletterRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/superuser/newsletters/runs',
  body: createNewsletterRunBodySchema,
  response: {
    mode: 'json',
    schema: newsletterRunResponseSchema,
  },
})

export const getNewsletterRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/superuser/newsletters/runs/[id]',
  params: newsletterRunIdParamsSchema,
  response: {
    mode: 'json',
    schema: newsletterRunResponseSchema,
  },
})

export const finalizeNewsletterRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/superuser/newsletters/runs/[id]/finalize',
  params: newsletterRunIdParamsSchema,
  response: {
    mode: 'json',
    schema: newsletterRunResponseSchema,
  },
})

export const pushNewsletterRunToResendContract = defineRouteContract({
  method: 'POST',
  path: '/api/superuser/newsletters/runs/[id]/push-resend',
  params: newsletterRunIdParamsSchema,
  response: {
    mode: 'json',
    schema: pushNewsletterRunResponseSchema,
  },
})

export const getNewsletterRunJobContract = defineRouteContract({
  method: 'GET',
  path: '/api/superuser/newsletters/runs/[id]/job',
  params: newsletterRunIdParamsSchema,
  response: {
    mode: 'json',
    schema: newsletterJobResponseSchema,
  },
})

export const exportNewsletterRunCsvContract = defineRouteContract({
  method: 'GET',
  path: '/api/superuser/newsletters/runs/[id]/export.csv',
  params: newsletterRunIdParamsSchema,
  response: {
    mode: 'text',
  },
})

export type NewsletterTargetingCriteria = z.output<typeof newsletterTargetingCriteriaSchema>
export type NewsletterRecipientSyncStatus = z.output<typeof newsletterRecipientSyncStatusSchema>
export type NewsletterRun = z.output<typeof newsletterRunSchema>
export type CreateNewsletterRunBody = z.input<typeof createNewsletterRunBodySchema>
export type ListNewsletterRunsResponse = z.output<typeof listNewsletterRunsResponseSchema>
export type NewsletterRunResponse = z.output<typeof newsletterRunResponseSchema>
export type PushNewsletterRunResponse = z.output<typeof pushNewsletterRunResponseSchema>
export type NewsletterJobResponse = z.output<typeof newsletterJobResponseSchema>
