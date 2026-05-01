import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
  adminV1SubscriptionSchema,
  lastQueryValue,
} from '@/lib/api/contracts/v1/admin/shared'

export const adminV1ListSubscriptionsQuerySchema = adminV1PaginationQuerySchema.extend({
  plan: adminV1QueryStringSchema,
  status: adminV1QueryStringSchema,
})

export const adminV1CancelSubscriptionQuerySchema = z.object({
  atPeriodEnd: z
    .preprocess(lastQueryValue, z.unknown())
    .pipe(z.enum(['true', 'false']).catch('false'))
    .transform((value) => value === 'true'),
  reason: adminV1QueryStringSchema.default('Admin cancellation (no reason provided)'),
})

const adminV1CancelSubscriptionResultSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  subscriptionId: z.string(),
  stripeSubscriptionId: z.string(),
  atPeriodEnd: z.boolean(),
  periodEnd: z.string().nullable().optional(),
})

export const adminV1ListSubscriptionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/subscriptions',
  query: adminV1ListSubscriptionsQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1SubscriptionSchema),
  },
})

export const adminV1GetSubscriptionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/subscriptions/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1SubscriptionSchema),
  },
})

export const adminV1CancelSubscriptionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/subscriptions/[id]',
  params: adminV1IdParamsSchema,
  query: adminV1CancelSubscriptionQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1CancelSubscriptionResultSchema),
  },
})

export const adminV1IssueCreditsBodySchema = z
  .object({
    userId: z.string({ error: 'userId must be a string' }).optional(),
    email: z.string({ error: 'email must be a string' }).optional(),
    amount: z
      .number({ error: 'amount must be a positive number' })
      .finite({ error: 'amount must be a positive number' })
      .positive({ error: 'amount must be a positive number' }),
    reason: z.string().optional(),
  })
  .refine((body) => body.userId || body.email, {
    error: 'Either userId or email is required',
  })
export type AdminV1IssueCreditsBodyInput = z.input<typeof adminV1IssueCreditsBodySchema>
export type AdminV1IssueCreditsBody = z.output<typeof adminV1IssueCreditsBodySchema>

const adminV1IssueCreditsResultSchema = z.object({
  success: z.literal(true),
  userId: z.string(),
  userEmail: z.string().nullable(),
  entityType: z.enum(['user', 'organization']),
  entityId: z.string(),
  amount: z.number(),
  newCreditBalance: z.number(),
  newUsageLimit: z.number(),
})

export const adminV1IssueCreditsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/credits',
  body: adminV1IssueCreditsBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1IssueCreditsResultSchema),
  },
})

export type AdminV1ListSubscriptionsResponse = ContractJsonResponse<
  typeof adminV1ListSubscriptionsContract
>
export type AdminV1GetSubscriptionResponse = ContractJsonResponse<
  typeof adminV1GetSubscriptionContract
>
export type AdminV1CancelSubscriptionResponse = ContractJsonResponse<
  typeof adminV1CancelSubscriptionContract
>
