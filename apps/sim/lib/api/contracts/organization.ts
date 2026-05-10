import { z } from 'zod'
import { organizationBillingDataSchema } from '@/lib/api/contracts/subscription'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'
import { HEX_COLOR_REGEX } from '@/lib/branding'

const booleanQueryParamSchema = z
  .preprocess((value) => {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }, z.boolean())
  .optional()

const numericResponseSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : value
}, z.number())

export const organizationRoleSchema = z.enum(['owner', 'admin', 'member'], {
  error: 'Invalid role',
})
export const organizationParamsSchema = z.object({
  id: z.string().min(1),
})

export const organizationMemberParamsSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
})

export const organizationMemberQuerySchema = z
  .object({
    include: z.string().optional(),
  })
  .passthrough()

export const removeOrganizationMemberQuerySchema = z.object({
  shouldReduceSeats: booleanQueryParamSchema,
})

export const workspaceGrantSchema = z.object({
  workspaceId: z.string().min(1),
  permission: workspacePermissionSchema,
})

export const createOrganizationBodySchema = z
  .object({
    name: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough()

export const updateOrganizationBodySchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').optional(),
  slug: z
    .string()
    .trim()
    .min(1, 'Organization slug is required')
    .regex(
      /^[a-z0-9-_]+$/,
      'Slug can only contain lowercase letters, numbers, hyphens, and underscores'
    )
    .optional(),
  logo: z.string().nullable().optional(),
})

export const createOrganizationInvitationBodySchema = z
  .object({
    email: z.string().optional(),
    emails: z.array(z.string()).optional(),
    role: z.enum(['member', 'admin'], { error: 'Invalid role' }).optional(),
    workspaceInvitations: z.array(workspaceGrantSchema).optional(),
  })
  .passthrough()

export const organizationInvitationsQuerySchema = z
  .object({
    validate: booleanQueryParamSchema,
    batch: booleanQueryParamSchema,
  })
  .passthrough()

export const updateOrganizationMemberRoleBodySchema = z.object({
  role: organizationRoleSchema,
})

export const inviteOrganizationMemberBodySchema = z
  .object({
    email: z.string({ error: 'Email is required' }).min(1, 'Email is required'),
    role: z.enum(['admin', 'member'], { error: 'Invalid role' }).optional(),
  })
  .passthrough()

const organizationDataRetentionHoursSchema = z
  .number()
  .int()
  .min(24)
  .max(43800)
  .nullable()
  .optional()

export const updateOrganizationDataRetentionBodySchema = z.object({
  logRetentionHours: organizationDataRetentionHoursSchema,
  softDeleteRetentionHours: organizationDataRetentionHoursSchema,
  taskCleanupHours: organizationDataRetentionHoursSchema,
})

const organizationRetentionValuesSchema = z.object({
  logRetentionHours: z.number().int().nullable(),
  softDeleteRetentionHours: z.number().int().nullable(),
  taskCleanupHours: z.number().int().nullable(),
})

export type OrganizationRetentionValues = z.output<typeof organizationRetentionValuesSchema>

const organizationDataRetentionDataSchema = z.object({
  isEnterprise: z.boolean(),
  defaults: organizationRetentionValuesSchema,
  configured: organizationRetentionValuesSchema,
  effective: organizationRetentionValuesSchema,
})

export type OrganizationDataRetention = z.output<typeof organizationDataRetentionDataSchema>

export const organizationDataRetentionResponseSchema = z.object({
  success: z.boolean(),
  data: organizationDataRetentionDataSchema,
})

export const updateOrganizationWhitelabelBodySchema = z.object({
  brandName: z
    .string()
    .trim()
    .max(64, 'Brand name must be 64 characters or fewer')
    .nullable()
    .optional(),
  logoUrl: z.string().min(1).nullable().optional(),
  wordmarkUrl: z.string().min(1).nullable().optional(),
  primaryColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Primary color must be a valid hex color (e.g. #701ffc)')
    .nullable()
    .optional(),
  primaryHoverColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Primary hover color must be a valid hex color')
    .nullable()
    .optional(),
  accentColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Accent color must be a valid hex color')
    .nullable()
    .optional(),
  accentHoverColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Accent hover color must be a valid hex color')
    .nullable()
    .optional(),
  supportEmail: z
    .string()
    .email('Support email must be a valid email address')
    .nullable()
    .optional(),
  documentationUrl: z.string().url('Documentation URL must be a valid URL').nullable().optional(),
  termsUrl: z.string().url('Terms URL must be a valid URL').nullable().optional(),
  privacyUrl: z.string().url('Privacy URL must be a valid URL').nullable().optional(),
  hidePoweredBySim: z.boolean().optional(),
})

export const transferOwnershipBodySchema = z.object({
  newOwnerUserId: z.string().min(1),
  alsoLeave: z.boolean().optional().default(false),
})

export const updateSeatsBodySchema = z.object({
  seats: z.number().int().min(1, 'Minimum 1 seat required').max(50, 'Maximum 50 seats allowed'),
})

export const rosterWorkspaceAccessSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  permission: workspacePermissionSchema,
})

export const rosterMemberSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'external']),
  createdAt: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  workspaces: z.array(rosterWorkspaceAccessSchema),
})

export const rosterPendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  kind: z.enum(['organization', 'workspace']),
  membershipIntent: z.enum(['internal', 'external']).optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  inviteeName: z.string().nullable(),
  inviteeImage: z.string().nullable(),
  workspaces: z.array(rosterWorkspaceAccessSchema),
})

export const organizationRosterSchema = z.object({
  members: z.array(rosterMemberSchema),
  pendingInvitations: z.array(rosterPendingInvitationSchema),
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
})

export const organizationMemberUsageSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.string(),
    role: organizationRoleSchema,
    createdAt: z.string(),
    userName: z.string().nullable(),
    userEmail: z.string().nullable(),
    currentPeriodCost: numericResponseSchema.nullable().optional(),
    currentUsageLimit: numericResponseSchema.nullable().optional(),
    usageLimitUpdatedAt: z.string().nullable().optional(),
    billingPeriodStart: z.string().nullable().optional(),
    billingPeriodEnd: z.string().nullable().optional(),
  })
  .passthrough()

export const listOrganizationMembersResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(organizationMemberUsageSchema),
    total: z.number(),
    userRole: organizationRoleSchema,
    hasAdminAccess: z.boolean(),
  })
  .passthrough()

const successResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
  })
  .passthrough()

const organizationInvitationValidationResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.unknown(),
    validatedBy: z.string(),
    validatedAt: z.string(),
  })
  .passthrough()

export const getOrganizationRosterContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/roster',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      data: organizationRosterSchema,
    }),
  },
})

export const listOrganizationMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/members',
  params: organizationParamsSchema,
  query: organizationMemberQuerySchema,
  response: {
    mode: 'json',
    schema: listOrganizationMembersResponseSchema,
  },
})

export const inviteOrganizationMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/members',
  params: organizationParamsSchema,
  body: inviteOrganizationMemberBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          invitationId: z.string(),
          email: z.string(),
          role: organizationRoleSchema,
        })
        .passthrough()
        .optional(),
    }),
  },
})

export const inviteOrganizationMembersContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/invitations',
  params: organizationParamsSchema,
  query: organizationInvitationsQuerySchema,
  body: createOrganizationInvitationBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      organizationInvitationValidationResponseSchema,
      successResponseSchema.extend({
        error: z.string().optional(),
        data: z
          .object({
            invitationsSent: z.number(),
            invitedEmails: z.array(z.string()),
            failedInvitations: z.array(z.object({ email: z.string(), error: z.string() })),
            existingMembers: z.array(z.string()),
            pendingInvitations: z.array(z.string()),
            invalidEmails: z.array(z.string()),
            workspaceGrantsPerInvite: z.number(),
            seatInfo: z
              .object({
                seatsUsed: z.number(),
                maxSeats: z.number(),
                availableSeats: z.number(),
              })
              .passthrough(),
          })
          .passthrough()
          .optional(),
      }),
    ]),
  },
})

export const updateOrganizationMemberRoleContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/members/[memberId]',
  params: organizationMemberParamsSchema,
  body: updateOrganizationMemberRoleBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          id: z.string(),
          userId: z.string(),
          role: organizationRoleSchema,
          updatedBy: z.string(),
        })
        .passthrough()
        .optional(),
    }),
  },
})

export const removeOrganizationMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/members/[memberId]',
  params: organizationMemberParamsSchema,
  query: removeOrganizationMemberQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  },
})

export const transferOwnershipContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/transfer-ownership',
  params: organizationParamsSchema,
  body: transferOwnershipBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({
        success: z.boolean(),
        transferred: z.boolean(),
        left: z.boolean(),
        warning: z.string().optional(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  },
})

export const updateSeatsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/seats',
  params: organizationParamsSchema,
  body: updateSeatsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          seats: z.number(),
          previousSeats: z.number().optional(),
          stripeSubscriptionId: z.string(),
          stripeStatus: z.string().optional(),
        })
        .passthrough()
        .optional(),
    }),
  },
})

export const updateOrganizationContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]',
  params: organizationParamsSchema,
  body: updateOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          id: z.string(),
          name: z.string(),
          slug: z.string().nullable(),
          logo: z.string().nullable(),
          updatedAt: z.string(),
        })
        .passthrough()
        .optional(),
    }),
  },
})

export const getOrganizationDataRetentionContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/data-retention',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: organizationDataRetentionResponseSchema,
  },
})

export const updateOrganizationDataRetentionContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/data-retention',
  params: organizationParamsSchema,
  body: updateOrganizationDataRetentionBodySchema,
  response: {
    mode: 'json',
    schema: organizationDataRetentionResponseSchema,
  },
})

// Read shape mirrors `OrganizationWhitelabelSettings` from
// `@/lib/branding/types`. All fields are optional (nullable on the way in
// for the PUT contract, but stored without nulls on the way out — the
// route deletes keys that are explicitly cleared).
export const organizationWhitelabelSettingsResponseSchema = z.object({
  brandName: z.string().optional(),
  logoUrl: z.string().optional(),
  wordmarkUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  primaryHoverColor: z.string().optional(),
  accentColor: z.string().optional(),
  accentHoverColor: z.string().optional(),
  supportEmail: z.string().optional(),
  documentationUrl: z.string().optional(),
  termsUrl: z.string().optional(),
  privacyUrl: z.string().optional(),
  hidePoweredBySim: z.boolean().optional(),
})

const organizationWhitelabelEnvelopeResponseSchema = z.object({
  success: z.boolean(),
  data: organizationWhitelabelSettingsResponseSchema,
})

export const getOrganizationWhitelabelContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/whitelabel',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: organizationWhitelabelEnvelopeResponseSchema,
  },
})

export const updateOrganizationWhitelabelContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/whitelabel',
  params: organizationParamsSchema,
  body: updateOrganizationWhitelabelBodySchema,
  response: {
    mode: 'json',
    schema: organizationWhitelabelEnvelopeResponseSchema,
  },
})

export const createOrganizationContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations',
  body: createOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      organizationId: z.string(),
      created: z.boolean(),
    }),
  },
})

export const updateOrganizationUsageLimitContract = defineRouteContract({
  method: 'PUT',
  path: '/api/usage',
  body: z.object({
    context: z.literal('organization'),
    organizationId: z.string().min(1),
    limit: z.number().min(0, 'Limit must be a non-negative number'),
  }),
  response: {
    mode: 'json',
    schema: z
      .object({
        success: z.boolean(),
        context: z.literal('organization'),
        userId: z.string(),
        organizationId: z.string(),
        data: organizationBillingDataSchema.nullable(),
      })
      .passthrough(),
  },
})

export type OrganizationRoster = z.infer<typeof organizationRosterSchema>
export type RosterWorkspaceAccess = z.infer<typeof rosterWorkspaceAccessSchema>
export type RosterMember = z.infer<typeof rosterMemberSchema>
export type RosterPendingInvitation = z.infer<typeof rosterPendingInvitationSchema>
export type OrganizationMembersResponse = z.infer<typeof listOrganizationMembersResponseSchema>
