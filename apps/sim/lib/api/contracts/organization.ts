import { z } from 'zod'
import {
  type PiiRedactionSettings,
  piiRedactionSettingsSchema,
  retentionOverridesSchema,
} from '@/lib/api/contracts/primitives'
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

export type { PiiRedactionSettings }

export const updateOrganizationDataRetentionBodySchema = z.object({
  logRetentionHours: organizationDataRetentionHoursSchema,
  softDeleteRetentionHours: organizationDataRetentionHoursSchema,
  taskCleanupHours: organizationDataRetentionHoursSchema,
  piiRedaction: piiRedactionSettingsSchema.optional(),
  retentionOverrides: retentionOverridesSchema.optional(),
})

export type UpdateOrganizationDataRetentionBody = z.input<
  typeof updateOrganizationDataRetentionBodySchema
>

const organizationRetentionValuesSchema = z.object({
  logRetentionHours: z.number().int().nullable(),
  softDeleteRetentionHours: z.number().int().nullable(),
  taskCleanupHours: z.number().int().nullable(),
  piiRedaction: piiRedactionSettingsSchema.nullable(),
  retentionOverrides: retentionOverridesSchema.nullable(),
})

export type OrganizationRetentionValues = z.output<typeof organizationRetentionValuesSchema>

const organizationDataRetentionDataSchema = z.object({
  isEnterprise: z.boolean(),
  defaults: organizationRetentionValuesSchema,
  configured: organizationRetentionValuesSchema,
  effective: organizationRetentionValuesSchema,
  piiRedactionEnabled: z.boolean(),
  piiGranularRedactionEnabled: z.boolean(),
})

export type OrganizationDataRetention = z.output<typeof organizationDataRetentionDataSchema>

export const organizationDataRetentionResponseSchema = z.object({
  success: z.boolean(),
  data: organizationDataRetentionDataSchema,
})

/**
 * Session-policy bounds — the single source for the contract validation, the
 * server-side clamp (`@/lib/auth/session-policy`), and the settings UI.
 * `MIN_IDLE_TIMEOUT_HOURS` is twice the session cookie-cache window (24h):
 * cached reads never record activity, so a continuously active user only
 * refreshes their session when the cookie cache expires. A floor of one
 * window would sign out active users exactly at the cache boundary; two
 * windows guarantees a DB-path refresh lands before the idle limit can.
 */
export const MIN_SESSION_LIFETIME_HOURS = 1
export const MIN_IDLE_TIMEOUT_HOURS = 48
export const MAX_SESSION_POLICY_HOURS = 8760

export const updateOrganizationSessionPolicyBodySchema = z.object({
  maxSessionHours: z
    .number()
    .int()
    .min(MIN_SESSION_LIFETIME_HOURS, 'Max session lifetime must be at least 1 hour')
    .max(MAX_SESSION_POLICY_HOURS, 'Max session lifetime cannot exceed 8760 hours (1 year)')
    .nullable(),
  idleTimeoutHours: z
    .number()
    .int()
    .min(
      MIN_IDLE_TIMEOUT_HOURS,
      'Idle timeout must be at least 48 hours — session activity is recorded at most once per 24h cookie-cache window'
    )
    .max(MAX_SESSION_POLICY_HOURS, 'Idle timeout cannot exceed 8760 hours (1 year)')
    .nullable(),
})

export type UpdateOrganizationSessionPolicyBody = z.input<
  typeof updateOrganizationSessionPolicyBodySchema
>

const organizationSessionPolicyValuesSchema = z.object({
  maxSessionHours: z.number().int().nullable(),
  idleTimeoutHours: z.number().int().nullable(),
})

const organizationSessionPolicyDataSchema = z.object({
  isEnterprise: z.boolean(),
  configured: organizationSessionPolicyValuesSchema,
})

export type OrganizationSessionPolicy = z.output<typeof organizationSessionPolicyDataSchema>

export const organizationSessionPolicyResponseSchema = z.object({
  success: z.boolean(),
  data: organizationSessionPolicyDataSchema,
})

export const revokeOrganizationSessionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    revokedSessions: z.number().int().min(0),
  }),
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
    .regex(HEX_COLOR_REGEX, 'Primary color must be a valid hex color (e.g. #33c482)')
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
            directlyAdded: z.array(z.string()).optional(),
            directlyAddedCount: z.number().optional(),
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
              .passthrough()
              .optional(),
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
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  },
})

/** Per-member credit usage + cap for the Manage Credits modal (values in credits). */
export const organizationMemberUsageLimitDataSchema = z.object({
  creditsUsed: z.number(),
  creditLimit: z.number().nullable(),
  /** Billing cadence of the org's subscription, so the UI can label the usage window. */
  billingInterval: z.enum(['month', 'year']),
})

export const getOrganizationMemberUsageLimitContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/members/[memberId]/usage-limit',
  params: organizationMemberParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      data: organizationMemberUsageLimitDataSchema,
    }),
  },
})

export const updateOrganizationMemberUsageLimitBodySchema = z.object({
  /** New cap in credits; `null` clears the per-member cap. */
  creditLimit: z
    .number()
    .int('Credit limit must be a whole number of credits')
    .min(0, 'Credit limit cannot be negative')
    .nullable(),
})

export const updateOrganizationMemberUsageLimitContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/members/[memberId]/usage-limit',
  params: organizationMemberParamsSchema,
  body: updateOrganizationMemberUsageLimitBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          creditLimit: z.number().nullable(),
        })
        .optional(),
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

export const getOrganizationSessionPolicyContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/session-policy',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: organizationSessionPolicyResponseSchema,
  },
})

export const updateOrganizationSessionPolicyContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/session-policy',
  params: organizationParamsSchema,
  body: updateOrganizationSessionPolicyBodySchema,
  response: {
    mode: 'json',
    schema: organizationSessionPolicyResponseSchema,
  },
})

export const revokeOrganizationSessionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/sessions/revoke',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: revokeOrganizationSessionsResponseSchema,
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
export type OrganizationMemberUsageLimitData = z.infer<
  typeof organizationMemberUsageLimitDataSchema
>
