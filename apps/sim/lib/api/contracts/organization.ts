import { z } from 'zod'
import {
  organizationRoleSchema,
  type PiiRedactionSettings,
  piiRedactionSettingsSchema,
  retentionOverridesSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { organizationBillingDataSchema } from '@/lib/api/contracts/subscription'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'
import { HEX_COLOR_REGEX } from '@/lib/branding'

const numericResponseSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : value
}, z.number())

export const organizationParamsSchema = z.object({
  id: z.string().min(1),
})

export const organizationMemberParamsSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
})

export const organizationMemberQuerySchema = z
  .object({
    include: z.enum(['usage']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .passthrough()

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

export const updateOrganizationMemberRoleBodySchema = z.object({
  role: organizationRoleSchema,
})

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

export const MAX_ORGANIZATION_DOMAINS = 25

export const organizationDomainParamsSchema = z.object({
  id: z.string().min(1),
  domainId: z.string().min(1),
})

export const addOrganizationDomainBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required').max(253, 'Domain is too long'),
})

export type AddOrganizationDomainBody = z.input<typeof addOrganizationDomainBodySchema>

export const organizationDomainStatusSchema = z.enum(['pending', 'verified'])

const organizationDomainSchema = z.object({
  id: z.string(),
  domain: z.string(),
  status: organizationDomainStatusSchema,
  verifiedAt: z.string().nullable(),
  /** DNS host the TXT record must live on (e.g. `_sim-challenge.acme.com`). */
  challengeHost: z.string(),
  /** Exact TXT record value the org must publish. Null for grandfathered/verified rows. */
  txtRecordValue: z.string().nullable(),
})

export type OrganizationDomain = z.output<typeof organizationDomainSchema>

const organizationDomainsDataSchema = z.object({
  isEnterprise: z.boolean(),
  domains: z.array(organizationDomainSchema),
})

export type OrganizationDomains = z.output<typeof organizationDomainsDataSchema>

export const listOrganizationDomainsResponseSchema = z.object({
  success: z.boolean(),
  data: organizationDomainsDataSchema,
})

export const organizationDomainResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({ domain: organizationDomainSchema }),
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
  /**
   * Why this role is fixed, when it is. Carried so the roster can disable the
   * controls the workspace-permissions route refuses, the way the teammates list
   * already does — without them it offers an edit that can only fail.
   */
  roleSource: z.enum(['owner', 'explicit', 'org-admin']),
  isBilledAccount: z.boolean(),
})

export const rosterMemberSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'external']),
  createdAt: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  /** Set while a directory deactivation blocks the member's sign-in; access is otherwise intact. */
  suspendedAt: z.string().nullable(),
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
    pagination: z.object({
      total: z.number().int().min(0),
      limit: z.number().int().min(1).max(100),
      offset: z.number().int().min(0),
      hasMore: z.boolean(),
    }),
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

export const removalImpactCredentialSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.string(),
  workspaceId: z.string(),
})

export const memberRemovalImpactQuerySchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
})

/**
 * Identity-bound credentials (OAuth accounts, personal env keys) the user owns
 * in organization workspaces. These stop working when the user's workspace
 * access is revoked and must be reconnected by a remaining member — removal is
 * never blocked, only disclosed.
 */
export const getMemberRemovalImpactContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/removal-impact',
  params: organizationParamsSchema,
  query: memberRemovalImpactQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentials: z.array(removalImpactCredentialSchema),
    }),
  },
})

export type RemovalImpactCredential = z.infer<typeof removalImpactCredentialSchema>

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

export const listOrganizationDomainsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/domains',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: listOrganizationDomainsResponseSchema,
  },
})

export const addOrganizationDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/domains',
  params: organizationParamsSchema,
  body: addOrganizationDomainBodySchema,
  response: {
    mode: 'json',
    schema: organizationDomainResponseSchema,
  },
})

export const verifyOrganizationDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/domains/[domainId]/verify',
  params: organizationDomainParamsSchema,
  response: {
    mode: 'json',
    schema: organizationDomainResponseSchema,
  },
})

export const removeOrganizationDomainContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/domains/[domainId]',
  params: organizationDomainParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.boolean() }),
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

export const organizationBillingSummarySchema = z.object({
  organizationId: z.string().min(1),
  subscriptionState: z.enum(['active', 'free', 'lapsed']),
  subscriptionPlan: z.string().min(1),
  subscriptionStatus: z.string().nullable(),
  creditBalance: z.number(),
  billingInterval: z.enum(['month', 'year']),
  cancelAtPeriodEnd: z.boolean(),
  totalSeats: z.number().int().min(0),
  totalCurrentUsage: z.number().min(0),
  totalUsageLimit: z.number().min(0),
  minimumBillingAmount: z.number().min(0),
  billingPeriodEnd: z.string().nullable(),
  billingBlocked: z.boolean(),
  billingBlockedReason: z.enum(['payment_failed', 'dispute']).nullable(),
  blockedByOrgOwner: z.boolean(),
  upgradeWorkspaceId: workspaceIdSchema.nullable(),
  userRole: z.enum(['admin', 'owner']),
})

export type OrganizationBillingSummary = z.output<typeof organizationBillingSummarySchema>

export const getOrganizationBillingSummaryContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/billing-summary',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: organizationBillingSummarySchema,
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
