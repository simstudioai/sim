import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1BooleanQuerySchema,
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1SingleResponseSchema,
  adminV1SubscriptionSchema,
} from '@/lib/api/contracts/v1/admin/shared'

export const adminV1OrganizationMemberParamsSchema = adminV1IdParamsSchema.extend({
  memberId: z.string().min(1),
})

export const adminV1OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  orgUsageLimit: z.string().nullable(),
  storageUsedBytes: z.number(),
  departedMemberUsage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1OrganizationDetailSchema = adminV1OrganizationSchema.extend({
  memberCount: z.number(),
  subscription: adminV1SubscriptionSchema.nullable(),
})

export const adminV1MemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  role: z.string(),
  createdAt: z.string(),
  userName: z.string(),
  userEmail: z.string(),
})

export const adminV1MemberDetailSchema = adminV1MemberSchema.extend({
  currentPeriodCost: z.string(),
  currentUsageLimit: z.string().nullable(),
  lastActive: z.string().nullable(),
  billingBlocked: z.boolean(),
})

export const adminV1OrganizationBillingSummarySchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  subscriptionPlan: z.string(),
  subscriptionStatus: z.string(),
  totalSeats: z.number(),
  usedSeats: z.number(),
  availableSeats: z.number(),
  totalCurrentUsage: z.number(),
  totalUsageLimit: z.number(),
  minimumBillingAmount: z.number(),
  averageUsagePerMember: z.number(),
  usagePercentage: z.number(),
  billingPeriodStart: z.string().nullable(),
  billingPeriodEnd: z.string().nullable(),
  membersOverLimit: z.number(),
  membersNearLimit: z.number(),
})

export const adminV1SeatAnalyticsSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  currentSeats: z.number(),
  maxSeats: z.number(),
  availableSeats: z.number(),
  subscriptionPlan: z.string(),
  canAddSeats: z.boolean(),
  utilizationRate: z.number(),
  activeMembers: z.number(),
  inactiveMembers: z.number(),
  memberActivity: z.array(
    z.object({
      userId: z.string(),
      userName: z.string(),
      userEmail: z.string(),
      role: z.string(),
      joinedAt: z.string(),
      lastActive: z.string().nullable(),
    })
  ),
})

export const adminV1CreateOrganizationBodySchema = z.object({
  name: z.string({ error: 'name is required' }).trim().min(1, { error: 'name is required' }),
  ownerId: z.string({ error: 'ownerId is required' }).min(1, { error: 'ownerId is required' }),
  slug: z.string().optional(),
})

export const adminV1UpdateOrganizationBodySchema = z.object({
  name: z
    .string({ error: 'name must be a non-empty string' })
    .trim()
    .min(1, { error: 'name must be a non-empty string' })
    .optional(),
  slug: z
    .string({ error: 'slug must be a non-empty string' })
    .trim()
    .min(1, { error: 'slug must be a non-empty string' })
    .optional(),
})

export const adminV1AddOrganizationMemberBodySchema = z.object({
  userId: z.string({ error: 'userId is required' }).min(1, { error: 'userId is required' }),
  role: z.enum(['admin', 'member'], { error: 'role must be "admin" or "member"' }),
})

export const adminV1UpdateOrganizationMemberBodySchema = z.object({
  role: z.enum(['admin', 'member'], { error: 'role must be "admin" or "member"' }),
})

export const adminV1RemoveOrganizationMemberQuerySchema = z.object({
  skipBillingLogic: adminV1BooleanQuerySchema,
})

export const adminV1UpdateOrganizationBillingBodySchema = z.object({
  orgUsageLimit: z
    .union([
      z
        .number({ error: 'orgUsageLimit must be a non-negative number or null' })
        .min(0, { error: 'orgUsageLimit must be a non-negative number or null' }),
      z.null(),
    ])
    .optional(),
})

export const adminV1TransferOwnershipBodySchema = z.object({
  newOwnerUserId: z
    .string({ error: 'newOwnerUserId is required' })
    .min(1, { error: 'newOwnerUserId is required' }),
  currentOwnerUserId: z
    .string({ error: 'currentOwnerUserId must be a non-empty string when provided' })
    .min(1, { error: 'currentOwnerUserId must be a non-empty string when provided' })
    .optional(),
})

const adminV1OrganizationMemberMutationResultSchema = adminV1MemberSchema.extend({
  action: z.enum(['created', 'updated', 'already_member']),
  billingActions: z.object({
    proUsageSnapshotted: z.boolean(),
    proCancelledAtPeriodEnd: z.boolean(),
  }),
})

const adminV1RemoveOrganizationMemberResultSchema = z.object({
  success: z.literal(true),
  memberId: z.string(),
  userId: z.string(),
  billingActions: z.object({
    usageCaptured: z.boolean(),
    proRestored: z.boolean(),
    usageRestored: z.boolean(),
    skipBillingLogic: z.boolean(),
  }),
})

const adminV1OrganizationBillingUpdateResultSchema = z.object({
  success: z.literal(true),
  orgUsageLimit: z.string().nullable(),
})

const adminV1TransferOwnershipResultSchema = z.object({
  organizationId: z.string(),
  currentOwnerUserId: z.string(),
  newOwnerUserId: z.string(),
  workspacesReassigned: z.number(),
  billedAccountReassigned: z.boolean(),
  overageMigrated: z.boolean(),
  billingBlockInherited: z.boolean(),
})

export const adminV1ListOrganizationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/organizations',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1OrganizationSchema),
  },
})

export const adminV1CreateOrganizationContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/organizations',
  body: adminV1CreateOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OrganizationSchema.extend({ memberId: z.string() })),
  },
})

export const adminV1GetOrganizationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/organizations/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OrganizationDetailSchema),
  },
})

export const adminV1UpdateOrganizationContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/organizations/[id]',
  params: adminV1IdParamsSchema,
  body: adminV1UpdateOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OrganizationSchema),
  },
})

export const adminV1ListOrganizationMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/organizations/[id]/members',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1MemberDetailSchema),
  },
})

export const adminV1AddOrganizationMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/organizations/[id]/members',
  params: adminV1IdParamsSchema,
  body: adminV1AddOrganizationMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OrganizationMemberMutationResultSchema),
  },
})

export const adminV1GetOrganizationMemberContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/organizations/[id]/members/[memberId]',
  params: adminV1OrganizationMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1MemberDetailSchema),
  },
})

export const adminV1UpdateOrganizationMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/organizations/[id]/members/[memberId]',
  params: adminV1OrganizationMemberParamsSchema,
  body: adminV1UpdateOrganizationMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1MemberSchema),
  },
})

export const adminV1RemoveOrganizationMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/organizations/[id]/members/[memberId]',
  params: adminV1OrganizationMemberParamsSchema,
  query: adminV1RemoveOrganizationMemberQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1RemoveOrganizationMemberResultSchema),
  },
})

export const adminV1GetOrganizationBillingContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/organizations/[id]/billing',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OrganizationBillingSummarySchema),
  },
})

export const adminV1UpdateOrganizationBillingContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/organizations/[id]/billing',
  params: adminV1IdParamsSchema,
  body: adminV1UpdateOrganizationBillingBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OrganizationBillingUpdateResultSchema),
  },
})

export const adminV1GetOrganizationSeatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/organizations/[id]/seats',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1SeatAnalyticsSchema),
  },
})

export const adminV1TransferOwnershipContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/organizations/[id]/transfer-ownership',
  params: adminV1IdParamsSchema,
  body: adminV1TransferOwnershipBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1TransferOwnershipResultSchema),
  },
})

export type AdminV1ListOrganizationsResponse = ContractJsonResponse<
  typeof adminV1ListOrganizationsContract
>
export type AdminV1CreateOrganizationResponse = ContractJsonResponse<
  typeof adminV1CreateOrganizationContract
>
export type AdminV1GetOrganizationResponse = ContractJsonResponse<
  typeof adminV1GetOrganizationContract
>
export type AdminV1UpdateOrganizationResponse = ContractJsonResponse<
  typeof adminV1UpdateOrganizationContract
>
export type AdminV1ListOrganizationMembersResponse = ContractJsonResponse<
  typeof adminV1ListOrganizationMembersContract
>
export type AdminV1AddOrganizationMemberResponse = ContractJsonResponse<
  typeof adminV1AddOrganizationMemberContract
>
export type AdminV1GetOrganizationMemberResponse = ContractJsonResponse<
  typeof adminV1GetOrganizationMemberContract
>
export type AdminV1UpdateOrganizationMemberResponse = ContractJsonResponse<
  typeof adminV1UpdateOrganizationMemberContract
>
export type AdminV1RemoveOrganizationMemberResponse = ContractJsonResponse<
  typeof adminV1RemoveOrganizationMemberContract
>
export type AdminV1GetOrganizationBillingResponse = ContractJsonResponse<
  typeof adminV1GetOrganizationBillingContract
>
export type AdminV1UpdateOrganizationBillingResponse = ContractJsonResponse<
  typeof adminV1UpdateOrganizationBillingContract
>
export type AdminV1GetOrganizationSeatsResponse = ContractJsonResponse<
  typeof adminV1GetOrganizationSeatsContract
>
export type AdminV1TransferOwnershipResponse = ContractJsonResponse<
  typeof adminV1TransferOwnershipContract
>
