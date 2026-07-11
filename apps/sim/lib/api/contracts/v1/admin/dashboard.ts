import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'

const creditsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

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
  includedMonthlyCredits: creditsSchema,
  usageLimitCredits: creditsSchema,
  seats: z.number().int().positive(),
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
  includedMonthlyCredits: creditsSchema,
  usageLimitCredits: creditsSchema,
  effectiveUsageLimitCredits: creditsSchema,
  prepaidCredits: creditsSchema,
  monthlyInvoiceAmountUsd: z.number().nullable(),
  provisioning: adminDashboardProvisioningSchema.nullable(),
})

export const adminDashboardOrganizationDetailSchema =
  adminDashboardOrganizationSummarySchema.extend({
    members: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.string(),
        usageLimitCredits: creditsSchema.nullable(),
      })
    ),
    externalCollaborators: z.array(
      z.object({
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        workspaceCount: z.number().int().min(1),
        usageLimitCredits: creditsSchema.nullable(),
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
  includedMonthlyCredits: creditsSchema,
  usageLimitCredits: creditsSchema.optional(),
  seats: z.number().int().positive().max(100_000),
})

export const adminDashboardSeatsBodySchema = z.object({
  seats: z.number().int().positive().max(100_000),
})

export const adminDashboardLimitsBodySchema = z
  .object({
    includedMonthlyCredits: creditsSchema.optional(),
    usageLimitCredits: creditsSchema.optional(),
  })
  .refine(
    (value) => value.includedMonthlyCredits !== undefined || value.usageLimitCredits !== undefined,
    { error: 'At least one limit must be provided' }
  )

export const adminDashboardCreditsBodySchema = z.object({
  operationId: z.string().uuid(),
  credits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(1).max(500).optional(),
})

export const adminDashboardAddMemberBodySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
  usageLimitCredits: creditsSchema.nullable().optional(),
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
    usageLimitCredits: creditsSchema.nullable().optional(),
  })
  .refine((value) => value.role !== undefined || value.usageLimitCredits !== undefined, {
    error: 'At least one member field must be provided',
  })

export const adminDashboardExternalCollaboratorLimitBodySchema = z.object({
  usageLimitCredits: creditsSchema.nullable(),
})

export const adminDashboardTransferOwnershipBodySchema = z.object({
  newOwnerUserId: z.string().min(1),
})

const adminDashboardMutationResultSchema = z.object({ success: z.literal(true) })
const adminDashboardCreditsResultSchema = adminDashboardMutationResultSchema.extend({
  prepaidCredits: creditsSchema,
  usageLimitCredits: creditsSchema,
})
const adminDashboardMemberResultSchema = adminDashboardMutationResultSchema.extend({
  memberId: z.string(),
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

export const adminDashboardGrantCreditsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/credits',
  params: adminV1IdParamsSchema,
  body: adminDashboardCreditsBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardCreditsResultSchema),
  },
})

export const adminDashboardGrantUserCreditsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/users/[id]/credits',
  params: adminV1IdParamsSchema,
  body: adminDashboardCreditsBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardCreditsResultSchema),
  },
})

export const adminDashboardAddMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/members',
  params: adminV1IdParamsSchema,
  body: adminDashboardAddMemberBodySchema,
  response: { mode: 'json', schema: adminV1SingleResponseSchema(adminDashboardMemberResultSchema) },
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
