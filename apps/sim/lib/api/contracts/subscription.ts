import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const booleanQueryParamSchema = z
  .preprocess((value) => {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }, z.boolean())
  .optional()
  .default(false)

export const billingUpdateCostBodySchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  cost: z.number().min(0, 'Cost must be a non-negative number'),
  model: z.string().min(1, 'Model is required'),
  inputTokens: z.number().min(0).default(0),
  outputTokens: z.number().min(0).default(0),
  source: z
    .enum(['copilot', 'workspace-chat', 'mcp_copilot', 'mothership_block'])
    .default('copilot'),
  idempotencyKey: z.string().min(1).optional(),
})
export type BillingUpdateCostBody = z.input<typeof billingUpdateCostBodySchema>

export const billingSwitchPlanBodySchema = z.object({
  targetPlanName: z.string(),
  interval: z.enum(['month', 'year']).optional(),
})
export type BillingSwitchPlanBody = z.input<typeof billingSwitchPlanBodySchema>

export const billingQuerySchema = z.object({
  context: z.enum(['user', 'organization']).optional().default('user'),
  id: z.string().min(1).optional(),
  includeOrg: booleanQueryParamSchema,
})

export const billingUsageDataSchema = z
  .object({
    current: z.number(),
    limit: z.number(),
    percentUsed: z.number(),
    isWarning: z.boolean(),
    isExceeded: z.boolean(),
    billingPeriodStart: z.string().nullable(),
    billingPeriodEnd: z.string().nullable(),
    lastPeriodCost: z.number(),
    lastPeriodCopilotCost: z.number(),
    daysRemaining: z.number(),
    copilotCost: z.number(),
  })
  .passthrough()

export const subscriptionBillingDataSchema = z
  .object({
    type: z.enum(['individual', 'organization']),
    plan: z.string(),
    currentUsage: z.number(),
    usageLimit: z.number(),
    percentUsed: z.number(),
    isWarning: z.boolean(),
    isExceeded: z.boolean(),
    daysRemaining: z.number(),
    creditBalance: z.number(),
    billingInterval: z.enum(['month', 'year']),
    isPaid: z.boolean(),
    isPro: z.boolean(),
    isTeam: z.boolean(),
    isEnterprise: z.boolean(),
    isOrgScoped: z.boolean(),
    organizationId: z.string().nullable(),
    status: z.string().nullable(),
    seats: z.number().nullable(),
    metadata: z.unknown().nullable(),
    stripeSubscriptionId: z.string().nullable(),
    periodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean().optional(),
    usage: billingUsageDataSchema,
    billingBlocked: z.boolean().optional(),
    billingBlockedReason: z.enum(['payment_failed', 'dispute']).nullable().optional(),
    blockedByOrgOwner: z.boolean().optional(),
    organization: z
      .object({
        id: z.string(),
        role: z.enum(['owner', 'admin', 'member']),
      })
      .optional(),
  })
  .passthrough()

export const subscriptionApiResponseSchema = z
  .object({
    success: z.boolean(),
    context: z.string(),
    data: subscriptionBillingDataSchema,
  })
  .passthrough()

export const organizationBillingMemberSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    userName: z.string().nullable().optional(),
    userEmail: z.string().nullable().optional(),
    joinedAt: z.string().nullable().optional(),
    lastActive: z.string().nullable().optional(),
  })
  .passthrough()

export const organizationBillingDataSchema = z
  .object({
    organizationId: z.string(),
    organizationName: z.string(),
    subscriptionPlan: z.string(),
    subscriptionStatus: z.string().nullable(),
    totalSeats: z.number(),
    usedSeats: z.number(),
    seatsCount: z.number(),
    totalCurrentUsage: z.number(),
    totalUsageLimit: z.number(),
    minimumBillingAmount: z.number(),
    averageUsagePerMember: z.number(),
    billingPeriodStart: z.string().nullable(),
    billingPeriodEnd: z.string().nullable(),
    members: z.array(organizationBillingMemberSchema),
    billingBlocked: z.boolean().optional(),
    billingBlockedReason: z.enum(['payment_failed', 'dispute']).nullable().optional(),
    blockedByOrgOwner: z.boolean().optional(),
  })
  .passthrough()

export const organizationBillingApiResponseSchema = z
  .object({
    success: z.boolean(),
    context: z.literal('organization'),
    data: organizationBillingDataSchema,
    userRole: z.enum(['owner', 'admin', 'member']),
    billingBlocked: z.boolean().optional(),
    billingBlockedReason: z.enum(['payment_failed', 'dispute']).nullable().optional(),
    blockedByOrgOwner: z.boolean().optional(),
  })
  .passthrough()

export const usageLimitDataSchema = z
  .object({
    currentLimit: z.number(),
    canEdit: z.boolean(),
    minimumLimit: z.number(),
    plan: z.string(),
    updatedAt: z.string().nullable(),
    scope: z.enum(['user', 'organization']),
    organizationId: z.string().nullable(),
  })
  .passthrough()

export const usageQuerySchema = z.object({
  context: z.enum(['user', 'organization']).optional().default('user'),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
})

export const updateUsageLimitBodySchema = z
  .object({
    limit: z.number().min(0, 'Limit must be a non-negative number'),
    context: z.enum(['user', 'organization']).optional().default('user'),
    organizationId: z.string().optional(),
  })
  .refine((data) => data.context !== 'organization' || data.organizationId, {
    message: 'Organization ID is required when context is organization',
  })

export const usageLimitApiResponseSchema = z
  .object({
    success: z.boolean(),
    context: z.string(),
    userId: z.string(),
    organizationId: z.string().nullable(),
    data: usageLimitDataSchema,
  })
  .passthrough()

export const organizationUsageLimitApiResponseSchema = z
  .object({
    success: z.boolean(),
    context: z.literal('organization'),
    userId: z.string(),
    organizationId: z.string(),
    data: organizationBillingDataSchema.nullable(),
  })
  .passthrough()

export const purchaseCreditsBodySchema = z.object({
  amount: z.number().min(10).max(1000),
  requestId: z.string().uuid(),
})

export const billingPortalBodySchema = z.object({
  context: z.enum(['user', 'organization']).optional().default('user'),
  organizationId: z.string().min(1).optional(),
  returnUrl: z.string().min(1).optional(),
})

const successResponseSchema = z.object({
  success: z.boolean(),
})

export const getBillingContract = defineRouteContract({
  method: 'GET',
  path: '/api/billing',
  query: billingQuerySchema,
  response: {
    mode: 'json',
    schema: z.union([subscriptionApiResponseSchema, organizationBillingApiResponseSchema]),
  },
})

export const getUserBillingContract = defineRouteContract({
  method: 'GET',
  path: '/api/billing',
  query: billingQuerySchema.extend({
    context: z.literal('user').optional().default('user'),
  }),
  response: {
    mode: 'json',
    schema: subscriptionApiResponseSchema,
  },
})

export const getOrganizationBillingContract = defineRouteContract({
  method: 'GET',
  path: '/api/billing',
  query: billingQuerySchema.extend({
    context: z.literal('organization'),
    id: z.string().min(1),
  }),
  response: {
    mode: 'json',
    schema: organizationBillingApiResponseSchema,
  },
})

export const getUsageLimitContract = defineRouteContract({
  method: 'GET',
  path: '/api/usage',
  query: usageQuerySchema,
  response: {
    mode: 'json',
    schema: z.union([usageLimitApiResponseSchema, organizationUsageLimitApiResponseSchema]),
  },
})

export const getUserUsageLimitContract = defineRouteContract({
  method: 'GET',
  path: '/api/usage',
  query: usageQuerySchema.extend({
    context: z.literal('user').optional().default('user'),
  }),
  response: {
    mode: 'json',
    schema: usageLimitApiResponseSchema,
  },
})

export const updateUsageLimitContract = defineRouteContract({
  method: 'PUT',
  path: '/api/usage',
  body: updateUsageLimitBodySchema,
  response: {
    mode: 'json',
    schema: z.union([usageLimitApiResponseSchema, organizationUsageLimitApiResponseSchema]),
  },
})

export const purchaseCreditsContract = defineRouteContract({
  method: 'POST',
  path: '/api/billing/credits',
  body: purchaseCreditsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const createBillingPortalContract = defineRouteContract({
  method: 'POST',
  path: '/api/billing/portal',
  body: billingPortalBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      url: z.string().min(1),
    }),
  },
})

export const billingSwitchPlanResponseSchema = z.object({
  success: z.literal(true),
  plan: z.string().optional(),
  interval: z.enum(['month', 'year']).optional(),
  message: z.string().optional(),
})

export const billingUpdateCostResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  data: z.object({
    userId: z.string().optional(),
    cost: z.number().optional(),
    billingEnabled: z.boolean().optional(),
    processedAt: z.string(),
    requestId: z.string(),
  }),
})

export const billingSwitchPlanContract = defineRouteContract({
  method: 'POST',
  path: '/api/billing/switch-plan',
  body: billingSwitchPlanBodySchema,
  response: {
    mode: 'json',
    schema: billingSwitchPlanResponseSchema,
  },
})

export const billingUpdateCostContract = defineRouteContract({
  method: 'POST',
  path: '/api/billing/update-cost',
  body: billingUpdateCostBodySchema,
  response: {
    mode: 'json',
    schema: billingUpdateCostResponseSchema,
  },
})

export type BillingUsageData = z.infer<typeof billingUsageDataSchema>
export type SubscriptionBillingData = z.infer<typeof subscriptionBillingDataSchema>
export type SubscriptionApiResponse = z.infer<typeof subscriptionApiResponseSchema>
export type OrganizationBillingApiResponse = z.infer<typeof organizationBillingApiResponseSchema>
export type UsageLimitApiResponse = z.infer<typeof usageLimitApiResponseSchema>
