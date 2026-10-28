import { z } from 'zod'
import {
  type ContractBody,
  type ContractJsonResponse,
  type ContractParams,
  type ContractQuery,
  type ContractQueryInput,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1QueryStringSchema,
  lastQueryValue,
} from '@/lib/api/contracts/v1/admin/shared'

const adminV1OutboxStatuses = ['pending', 'processing', 'completed', 'dead_letter'] as const

export const adminV1OutboxQuerySchema = z.object({
  status: z.preprocess(
    lastQueryValue,
    z
      .enum(adminV1OutboxStatuses, {
        error: `Invalid status. Must be one of: ${adminV1OutboxStatuses.join(', ')}`,
      })
      .optional()
      .default('dead_letter')
  ),
  eventType: adminV1QueryStringSchema.transform((value) => value ?? null),
  limit: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(100))
    .catch(100)
    .transform((limit) => {
      if (!Number.isFinite(limit) || limit <= 0) return 100
      return Math.min(500, Math.max(1, limit))
    }),
})

const adminV1OutboxListResultSchema = z.object({
  success: z.literal(true),
  filter: z.object({
    status: z.enum(adminV1OutboxStatuses),
    eventType: z.string().nullable(),
    limit: z.number(),
  }),
  rows: z.array(z.unknown()),
  counts: z.array(
    z.object({
      status: z.string(),
      eventType: z.string(),
      count: z.number(),
    })
  ),
})

const adminV1OutboxRequeueResultSchema = z.object({
  success: z.literal(true),
  requeued: z.object({
    id: z.string(),
    eventType: z.string(),
  }),
})

/** Bounded so the 500-character `last_error` keeps at least 100 characters of the last failure. */
const adminV1ResolveOutboxEventBodySchema = z.object({
  reason: z
    .string({ error: 'reason is required' })
    .trim()
    .min(1, 'reason is required')
    .max(300, 'reason must be at most 300 characters'),
  resolvedBy: z
    .string({ error: 'resolvedBy is required' })
    .trim()
    .min(1, 'resolvedBy is required')
    .max(60, 'resolvedBy must be at most 60 characters'),
})

const adminV1OutboxResolveResultSchema = z.object({
  success: z.literal(true),
  resolved: z.object({
    id: z.string(),
    eventType: z.string(),
    lastError: z.string().nullable(),
  }),
})

export const adminV1ListOutboxContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/outbox',
  query: adminV1OutboxQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1OutboxListResultSchema,
  },
})

export const adminV1RequeueOutboxEventContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/outbox/[id]/requeue',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1OutboxRequeueResultSchema,
  },
})

export const adminV1ResolveOutboxEventContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/outbox/[id]/resolve',
  params: adminV1IdParamsSchema,
  body: adminV1ResolveOutboxEventBodySchema,
  response: {
    mode: 'json',
    schema: adminV1OutboxResolveResultSchema,
  },
})

export type AdminV1ListOutboxQueryInput = ContractQueryInput<typeof adminV1ListOutboxContract>
export type AdminV1ListOutboxQuery = ContractQuery<typeof adminV1ListOutboxContract>
export type AdminV1RequeueOutboxEventParams = ContractParams<
  typeof adminV1RequeueOutboxEventContract
>
export type AdminV1ListOutboxResponse = ContractJsonResponse<typeof adminV1ListOutboxContract>
export type AdminV1RequeueOutboxEventResponse = ContractJsonResponse<
  typeof adminV1RequeueOutboxEventContract
>
export type AdminV1ResolveOutboxEventBody = ContractBody<typeof adminV1ResolveOutboxEventContract>
export type AdminV1ResolveOutboxEventResponse = ContractJsonResponse<
  typeof adminV1ResolveOutboxEventContract
>
