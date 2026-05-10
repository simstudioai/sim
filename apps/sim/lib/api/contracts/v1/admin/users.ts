import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1SingleResponseSchema,
  adminV1SubscriptionSchema,
} from '@/lib/api/contracts/v1/admin/shared'

export const adminV1UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1UserBillingSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  stripeCustomerId: z.string().nullable(),
  totalManualExecutions: z.number(),
  totalApiCalls: z.number(),
  totalWebhookTriggers: z.number(),
  totalScheduledExecutions: z.number(),
  totalChatExecutions: z.number(),
  totalMcpExecutions: z.number(),
  totalA2aExecutions: z.number(),
  totalTokensUsed: z.number(),
  totalCost: z.string(),
  currentUsageLimit: z.string().nullable(),
  currentPeriodCost: z.string(),
  lastPeriodCost: z.string().nullable(),
  billedOverageThisPeriod: z.string(),
  storageUsedBytes: z.number(),
  lastActive: z.string().nullable(),
  billingBlocked: z.boolean(),
  totalCopilotCost: z.string(),
  currentPeriodCopilotCost: z.string(),
  lastPeriodCopilotCost: z.string().nullable(),
  totalCopilotTokens: z.number(),
  totalCopilotCalls: z.number(),
})

export const adminV1UserBillingWithSubscriptionSchema = adminV1UserBillingSchema.extend({
  subscriptions: z.array(adminV1SubscriptionSchema),
  organizationMemberships: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      role: z.string(),
    })
  ),
})

export const adminV1UpdateUserBillingBodySchema = z.object({
  currentUsageLimit: z
    .union([
      z
        .number({ error: 'currentUsageLimit must be a non-negative number or null' })
        .min(0, { error: 'currentUsageLimit must be a non-negative number or null' }),
      z.null(),
    ])
    .optional(),
  billingBlocked: z.boolean({ error: 'billingBlocked must be a boolean' }).optional(),
  currentPeriodCost: z
    .number({ error: 'currentPeriodCost must be a non-negative number' })
    .min(0, { error: 'currentPeriodCost must be a non-negative number' })
    .optional(),
  reason: z.string().optional(),
})

const adminV1UserBillingUpdateResultSchema = z.object({
  success: z.literal(true),
  updated: z.array(z.string()),
  warnings: z.array(z.string()),
  reason: z.string(),
})

export const adminV1ListUsersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/users',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1UserSchema),
  },
})

export const adminV1GetUserContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/users/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1UserSchema),
  },
})

export const adminV1GetUserBillingContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/users/[id]/billing',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1UserBillingWithSubscriptionSchema),
  },
})

export const adminV1UpdateUserBillingContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/users/[id]/billing',
  params: adminV1IdParamsSchema,
  body: adminV1UpdateUserBillingBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1UserBillingUpdateResultSchema),
  },
})

export type AdminV1ListUsersResponse = ContractJsonResponse<typeof adminV1ListUsersContract>
export type AdminV1GetUserResponse = ContractJsonResponse<typeof adminV1GetUserContract>
export type AdminV1GetUserBillingResponse = ContractJsonResponse<
  typeof adminV1GetUserBillingContract
>
export type AdminV1UpdateUserBillingResponse = ContractJsonResponse<
  typeof adminV1UpdateUserBillingContract
>
