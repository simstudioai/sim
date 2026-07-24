import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'

const dollarAmountSchema = z
  .number()
  .finite()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER / 200)
const creditAlignedDollarAmountSchema = dollarAmountSchema.refine(
  (value) => Math.abs(value * 200 - Math.round(value * 200)) < 1e-8,
  { error: 'Dollar amounts must use $0.005 increments' }
)
const positiveCreditAlignedDollarAmountSchema = creditAlignedDollarAmountSchema.refine(
  (value) => value > 0,
  {
    error: 'Dollar amount must be positive',
  }
)

export const adminDashboardUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  activeOrganization: z.object({ id: z.string(), name: z.string() }).nullable(),
})

export const adminDashboardProvisioningSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  organizationId: z.string(),
  status: z.enum(['pending', 'processing', 'dead_letter', 'awaiting_webhook', 'applied']),
  monthlyInvoiceAmountUsd: z.number(),
  usageLimitDollars: creditAlignedDollarAmountSchema,
  seats: z.number().int().positive(),
  concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT),
  pausePaymentCollection: z.boolean(),
  stripeSubscriptionId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminDashboardOrganizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  isActive: z.boolean(),
  subscriptionStatus: z.string().nullable(),
  plan: z.string().nullable(),
  planLabel: z.string(),
  memberCount: z.number().int().min(0),
  externalCollaboratorCount: z.number().int().min(0),
  seats: z.number().int().min(0),
  concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT).nullable(),
  planAllowanceDollars: dollarAmountSchema.nullable(),
  usageLimitDollars: dollarAmountSchema,
  effectiveUsageLimitDollars: dollarAmountSchema,
  prepaidBalanceDollars: dollarAmountSchema,
  monthlyInvoiceAmountUsd: z.number().nullable(),
  provisioning: adminDashboardProvisioningSchema.nullable(),
})

export const adminDashboardOrganizationDetailSchema =
  adminDashboardOrganizationSummarySchema.extend({
    configurationUpdate: z
      .object({
        id: z.string(),
        status: z.enum(['pending', 'processing', 'failed']),
        requestedUsageLimitDollars: dollarAmountSchema.nullable(),
        requestedSeats: z.number().int().positive().nullable(),
        requestedConcurrencyLimit: z
          .number()
          .int()
          .positive()
          .max(MAX_BILLING_CONCURRENCY_LIMIT)
          .nullable(),
        error: z.string().nullable(),
      })
      .nullable(),
    members: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.string(),
        usageLimitDollars: dollarAmountSchema.nullable(),
      })
    ),
    externalCollaborators: z.array(
      z.object({
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        workspaceCount: z.number().int().min(1),
        usageLimitDollars: dollarAmountSchema.nullable(),
      })
    ),
    workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
    subscription: z
      .object({
        id: z.string(),
        plan: z.string(),
        status: z.string().nullable(),
        periodStart: z.string().nullable(),
        periodEnd: z.string().nullable(),
        stripeSubscriptionId: z.string().nullable(),
        invoiceAmountUsd: z.number().nullable(),
      })
      .nullable(),
  })

export const adminDashboardSearchQuerySchema = adminV1PaginationQuerySchema.extend({
  search: adminV1QueryStringSchema.default(''),
})

export const adminDashboardIssueEnterpriseBodySchema = z.object({
  ownerUserId: z.string().min(1),
  organizationName: z.string().trim().min(1).max(120).optional(),
  monthlyInvoiceAmountUsd: z.number().min(0.01).max(10_000_000).multipleOf(0.01),
  usageLimitDollars: creditAlignedDollarAmountSchema.optional(),
  seats: z.number().int().positive().max(100_000),
  concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT).optional(),
  pausePaymentCollection: z.boolean().optional(),
})

export const adminDashboardSeatsBodySchema = z.object({
  seats: z.number().int().positive().max(100_000),
})

export const adminDashboardLimitsBodySchema = z
  .object({
    usageLimitDollars: creditAlignedDollarAmountSchema.optional(),
    concurrencyLimit: z
      .number()
      .int()
      .positive()
      .max(MAX_BILLING_CONCURRENCY_LIMIT)
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.usageLimitDollars !== undefined || value.concurrencyLimit !== undefined,
    { error: 'At least one limit must be provided' }
  )

export const adminDashboardBalanceGrantBodySchema = z.object({
  operationId: z.string().uuid(),
  amountDollars: positiveCreditAlignedDollarAmountSchema,
  reason: z.string().trim().min(1).max(500).optional(),
})

export const adminDashboardAddMemberBodySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
  usageLimitDollars: dollarAmountSchema.nullable().optional(),
  personalWorkspaceIds: z.array(z.string().min(1)).max(100).default([]),
})

export const adminDashboardMemberPreflightQuerySchema = z.object({
  userId: z.string().min(1),
})

export const adminDashboardMemberPreflightSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  currentOrganization: z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
  personalWorkspaces: z.array(
    z.object({ id: z.string(), name: z.string(), archived: z.boolean() })
  ),
  credentialDependencies: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      type: z.string(),
      workspaceId: z.string(),
    })
  ),
  canAdd: z.boolean(),
  reason: z.string().nullable(),
})

export const adminDashboardMemberParamsSchema = adminV1IdParamsSchema.extend({
  memberId: z.string().min(1),
})

export const adminDashboardExternalCollaboratorParamsSchema = adminV1IdParamsSchema.extend({
  userId: z.string().min(1),
})

export const adminDashboardUpdateMemberBodySchema = z
  .object({
    role: z.enum(['admin', 'member']).optional(),
    usageLimitDollars: dollarAmountSchema.nullable().optional(),
  })
  .refine((value) => value.role !== undefined || value.usageLimitDollars !== undefined, {
    error: 'At least one member field must be provided',
  })

export const adminDashboardExternalCollaboratorLimitBodySchema = z.object({
  usageLimitDollars: dollarAmountSchema.nullable(),
})

export const adminDashboardTransferOwnershipBodySchema = z.object({
  newOwnerUserId: z.string().min(1),
})

const adminDashboardMutationResultSchema = z.object({ success: z.literal(true) })
const adminDashboardBalanceGrantResultSchema = adminDashboardMutationResultSchema.extend({
  prepaidBalanceDollars: dollarAmountSchema,
  usageLimitDollars: dollarAmountSchema,
})
const adminDashboardMemberResultSchema = adminDashboardMutationResultSchema.extend({
  memberId: z.string(),
  transferredFromOrganizationId: z.string().nullable(),
  workspaceMoves: z.array(
    z.object({ workspaceId: z.string(), success: z.boolean(), error: z.string().optional() })
  ),
})

export const adminDashboardListUsersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/users',
  query: adminDashboardSearchQuerySchema,
  response: { mode: 'json', schema: adminV1ListResponseSchema(adminDashboardUserSchema) },
})

export const adminDashboardListOrganizationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/organizations',
  query: adminDashboardSearchQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminDashboardOrganizationSummarySchema),
  },
})

export const adminDashboardGetOrganizationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/organizations/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardOrganizationDetailSchema),
  },
})

export const adminDashboardIssueEnterpriseContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-provisioning',
  body: adminDashboardIssueEnterpriseBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardProvisioningSchema),
  },
})

export const adminDashboardRetryEnterpriseContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-provisioning/[id]/retry',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardProvisioningSchema),
  },
})

export const adminDashboardUpdateSeatsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/dashboard/organizations/[id]/seats',
  params: adminV1IdParamsSchema,
  body: adminDashboardSeatsBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export const adminDashboardUpdateLimitsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/dashboard/organizations/[id]/limits',
  params: adminV1IdParamsSchema,
  body: adminDashboardLimitsBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export const adminDashboardGrantBalanceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/credits',
  params: adminV1IdParamsSchema,
  body: adminDashboardBalanceGrantBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardBalanceGrantResultSchema),
  },
})

export const adminDashboardGrantUserBalanceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/users/[id]/credits',
  params: adminV1IdParamsSchema,
  body: adminDashboardBalanceGrantBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardBalanceGrantResultSchema),
  },
})

export const adminDashboardAddMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/members',
  params: adminV1IdParamsSchema,
  body: adminDashboardAddMemberBodySchema,
  response: { mode: 'json', schema: adminV1SingleResponseSchema(adminDashboardMemberResultSchema) },
})

export const adminDashboardMemberPreflightContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/organizations/[id]/members/preflight',
  params: adminV1IdParamsSchema,
  query: adminDashboardMemberPreflightQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMemberPreflightSchema),
  },
})

export const adminDashboardUpdateMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/dashboard/organizations/[id]/members/[memberId]',
  params: adminDashboardMemberParamsSchema,
  body: adminDashboardUpdateMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export const adminDashboardRemoveMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/dashboard/organizations/[id]/members/[memberId]',
  params: adminDashboardMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export const adminDashboardUpdateExternalCollaboratorLimitContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/dashboard/organizations/[id]/external-collaborators/[userId]',
  params: adminDashboardExternalCollaboratorParamsSchema,
  body: adminDashboardExternalCollaboratorLimitBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export const adminDashboardTransferOwnershipContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/transfer-ownership',
  params: adminV1IdParamsSchema,
  body: adminDashboardTransferOwnershipBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export type AdminDashboardListUsersResponse = ContractJsonResponse<
  typeof adminDashboardListUsersContract
>
export type AdminDashboardListOrganizationsResponse = ContractJsonResponse<
  typeof adminDashboardListOrganizationsContract
>
export type AdminDashboardGetOrganizationResponse = ContractJsonResponse<
  typeof adminDashboardGetOrganizationContract
>
export type AdminDashboardIssueEnterpriseResponse = ContractJsonResponse<
  typeof adminDashboardIssueEnterpriseContract
>
