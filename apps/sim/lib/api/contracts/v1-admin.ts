import { z } from 'zod'
import {
  type ContractBody,
  type ContractBodyInput,
  type ContractJsonResponse,
  type ContractParams,
  type ContractQuery,
  type ContractQueryInput,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

export const adminV1DefaultLimit = 50
export const adminV1MaxLimit = 250

const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

export const adminV1IdParamsSchema = z.object({
  id: z.string().min(1),
})

export const adminV1OrganizationMemberParamsSchema = adminV1IdParamsSchema.extend({
  memberId: z.string().min(1),
})

export const adminV1WorkflowVersionParamsSchema = adminV1IdParamsSchema.extend({
  versionId: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 1, {
      error: 'Invalid version number',
    }),
})

export const adminV1WorkspaceMemberParamsSchema = adminV1IdParamsSchema.extend({
  memberId: z.string().min(1),
})

export const adminV1PaginationQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(adminV1DefaultLimit))
    .catch(adminV1DefaultLimit)
    .transform((limit) => {
      if (limit < 1) return adminV1DefaultLimit
      return Math.min(limit, adminV1MaxLimit)
    }),
  offset: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(0))
    .catch(0)
    .transform((offset) => {
      if (offset < 0) return 0
      return offset
    }),
})

const adminV1BooleanQuerySchema = z
  .preprocess(lastQueryValue, z.enum(['true', 'false']).optional().catch(undefined))
  .transform((value) => value === 'true')

export const adminV1ExportFormatQuerySchema = z.object({
  format: z.preprocess(lastQueryValue, z.enum(['zip', 'json']).catch('zip')),
})

export const adminV1DeleteWorkspaceMemberQuerySchema = z.object({
  userId: z.preprocess(
    lastQueryValue,
    z
      .string({ error: 'userId query parameter is required' })
      .min(1, { error: 'userId query parameter is required' })
  ),
})

const adminV1QueryStringSchema = z.preprocess(lastQueryValue, z.string().optional())

export const adminV1WorkspaceImportQuerySchema = z.object({
  createFolders: z
    .preprocess(lastQueryValue, z.enum(['true', 'false']).catch('true'))
    .transform((value) => value !== 'false'),
  rootFolderName: adminV1QueryStringSchema,
})

const adminV1PaginationMetaSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
})

const adminV1ListResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: adminV1PaginationMetaSchema,
  })

const adminV1SingleResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  })

export const adminV1UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1SubscriptionSchema = z.object({
  id: z.string(),
  plan: z.string(),
  referenceId: z.string(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  status: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean().nullable(),
  seats: z.number().nullable(),
  trialStart: z.string().nullable(),
  trialEnd: z.string().nullable(),
  metadata: z.unknown(),
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

export const adminV1WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1WorkspaceDetailSchema = adminV1WorkspaceSchema.extend({
  workflowCount: z.number(),
  folderCount: z.number(),
})

export const adminV1FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  workspaceId: z.string().nullable(),
  folderId: z.string().nullable(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  runCount: z.number(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1WorkflowDetailSchema = adminV1WorkflowSchema.extend({
  blockCount: z.number(),
  edgeCount: z.number(),
})

export const adminV1WorkspaceMemberSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  permissions: workspacePermissionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  userImage: z.string().nullable(),
})

export const adminV1WorkflowVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.unknown(),
})

export const adminV1WorkflowExportStateSchema = workflowStateSchema.extend({
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      exportedAt: z.string().optional(),
    })
    .optional(),
  variables: z.record(z.string(), adminV1WorkflowVariableSchema).optional(),
})

export const adminV1WorkflowExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string(),
    workspaceId: z.string().nullable(),
    folderId: z.string().nullable(),
  }),
  state: adminV1WorkflowExportStateSchema,
})

export const adminV1FolderExportPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
})

export const adminV1WorkspaceExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
  }),
  workflows: z.array(
    z.object({
      workflow: adminV1WorkflowExportPayloadSchema.shape.workflow,
      state: adminV1WorkflowExportStateSchema,
    })
  ),
  folders: z.array(adminV1FolderExportPayloadSchema),
})

export const adminV1FolderFullExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  folder: z.object({
    id: z.string(),
    name: z.string(),
  }),
  workflows: z.array(
    z.object({
      workflow: adminV1WorkflowExportPayloadSchema.shape.workflow.omit({ workspaceId: true }),
      state: adminV1WorkflowExportStateSchema,
    })
  ),
  folders: z.array(adminV1FolderExportPayloadSchema),
})

export const adminV1ImportResultSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const adminV1WorkflowImportResponseSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.literal(true),
})

export const adminV1WorkspaceImportResponseSchema = z.object({
  imported: z.number(),
  failed: z.number(),
  results: z.array(adminV1ImportResultSchema),
})

export const adminV1DeploymentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  deployedByName: z.string().nullable(),
})

export const adminV1DeployResultSchema = z.object({
  isDeployed: z.literal(true),
  version: z.number(),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
})

export const adminV1UndeployResultSchema = z.object({
  isDeployed: z.literal(false),
})

const adminV1ReferralCampaignDurations = ['once', 'repeating', 'forever'] as const
const adminV1ReferralCampaignAppliesTo = [
  'pro',
  'team',
  'pro_6000',
  'pro_25000',
  'team_6000',
  'team_25000',
] as const
const adminV1OutboxStatuses = ['pending', 'processing', 'completed', 'dead_letter'] as const

export const adminV1PermissionGroupSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable(),
  organizationId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number(),
  createdAt: z.string(),
  createdByUserId: z.string(),
  createdByEmail: z.string().nullable(),
})

export const adminV1PromoCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  couponId: z.string(),
  name: z.string(),
  percentOff: z.number(),
  duration: z.string(),
  durationInMonths: z.number().nullable(),
  appliesToProductIds: z.array(z.string()).nullable(),
  maxRedemptions: z.number().nullable(),
  expiresAt: z.string().nullable(),
  active: z.boolean(),
  timesRedeemed: z.number(),
  createdAt: z.string(),
})

export const adminV1AccessControlQuerySchema = z.object({
  workspaceId: adminV1QueryStringSchema,
  organizationId: adminV1QueryStringSchema,
})

export const adminV1AccessControlDeleteQuerySchema = adminV1AccessControlQuerySchema
  .extend({
    reason: adminV1QueryStringSchema.default('Enterprise plan churn cleanup'),
  })
  .refine((query) => query.workspaceId || query.organizationId, {
    error: 'workspaceId or organizationId is required',
  })

export const adminV1ReferralCampaignQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(50))
    .catch(50)
    .transform((limit) => {
      if (limit < 1) return 50
      return Math.min(limit, 100)
    }),
  starting_after: adminV1QueryStringSchema,
  active: z
    .preprocess(lastQueryValue, z.enum(['true', 'false']).optional().catch(undefined))
    .transform((active) => (active === undefined ? undefined : active === 'true')),
})

const adminV1FutureIsoDateSchema = z
  .string({ error: 'expiresAt must be a valid ISO 8601 date string' })
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    error: 'expiresAt must be a valid ISO 8601 date string',
  })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    error: 'expiresAt must be in the future',
  })

export const adminV1ReferralCampaignBodySchema = z
  .object({
    name: z
      .string({ error: 'name is required and must be a non-empty string' })
      .trim()
      .min(1, { error: 'name is required and must be a non-empty string' }),
    percentOff: z
      .number({ error: 'percentOff must be a number between 1 and 100' })
      .finite({ error: 'percentOff must be a number between 1 and 100' })
      .min(1, { error: 'percentOff must be a number between 1 and 100' })
      .max(100, { error: 'percentOff must be a number between 1 and 100' }),
    code: z
      .union([
        z
          .string({ error: 'code must be a string or null' })
          .trim()
          .min(6, { error: 'code must be at least 6 characters' }),
        z.null(),
      ])
      .optional(),
    duration: z
      .enum(adminV1ReferralCampaignDurations, {
        error: `duration must be one of: ${adminV1ReferralCampaignDurations.join(', ')}`,
      })
      .optional()
      .default('once'),
    durationInMonths: z
      .number({
        error:
          'durationInMonths is required and must be a positive integer when duration is "repeating"',
      })
      .int({
        error:
          'durationInMonths is required and must be a positive integer when duration is "repeating"',
      })
      .min(1, {
        error:
          'durationInMonths is required and must be a positive integer when duration is "repeating"',
      })
      .optional(),
    maxRedemptions: z
      .union([
        z
          .number({ error: 'maxRedemptions must be a positive integer' })
          .int({ error: 'maxRedemptions must be a positive integer' })
          .min(1, { error: 'maxRedemptions must be a positive integer' }),
        z.null(),
      ])
      .optional(),
    expiresAt: z.union([adminV1FutureIsoDateSchema, z.null()]).optional(),
    appliesTo: z
      .union([
        z
          .array(z.enum(adminV1ReferralCampaignAppliesTo), {
            error: 'appliesTo must be a non-empty array',
          })
          .nonempty({ error: 'appliesTo must be a non-empty array' }),
        z.null(),
      ])
      .optional(),
  })
  .refine((body) => body.duration !== 'repeating' || body.durationInMonths !== undefined, {
    error:
      'durationInMonths is required and must be a positive integer when duration is "repeating"',
    path: ['durationInMonths'],
  })

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

export const adminV1WorkspaceMemberBodySchema = z.object({
  userId: z.string({ error: 'userId is required' }).min(1, { error: 'userId is required' }),
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

export const adminV1UpdateWorkspaceMemberBodySchema = z.object({
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

export const adminV1ExportWorkflowsBodySchema = z.object({
  ids: z
    .array(z.string(), { error: 'ids must be a non-empty array of workflow IDs' })
    .nonempty({ error: 'ids must be a non-empty array of workflow IDs' }),
})

export const adminV1WorkflowImportBodySchema = z.object({
  workspaceId: z
    .string({ error: 'workspaceId is required' })
    .min(1, { error: 'workspaceId is required' }),
  folderId: z.string().optional(),
  name: z.string().optional(),
  workflow: z.union([
    z.string({ error: 'workflow is required' }).min(1, { error: 'workflow is required' }),
    z.record(z.string(), z.unknown()),
  ]),
})

export const adminV1WorkspaceImportBodySchema = z.object({
  workflows: z.array(
    z.object({
      content: z.union([z.string(), z.record(z.string(), z.unknown())]),
      name: z.string().optional(),
      folderPath: z.array(z.string()).optional(),
    }),
    { error: 'Invalid JSON body. Expected { workflows: [...] }' }
  ),
})

const adminV1UserBillingUpdateResultSchema = z.object({
  success: z.literal(true),
  updated: z.array(z.string()),
  warnings: z.array(z.string()),
  reason: z.string(),
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

const adminV1CancelSubscriptionResultSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  subscriptionId: z.string(),
  stripeSubscriptionId: z.string(),
  atPeriodEnd: z.boolean(),
  periodEnd: z.string().nullable().optional(),
})

const adminV1AccessControlListResultSchema = z.object({
  data: z.array(adminV1PermissionGroupSchema),
  pagination: adminV1PaginationMetaSchema,
})

const adminV1AccessControlDeleteResultSchema = z.object({
  success: z.literal(true),
  deletedCount: z.number(),
  membersRemoved: z.number(),
  reason: z.string().optional(),
  message: z.string().optional(),
})

const adminV1ReferralCampaignListResultSchema = z.object({
  data: z.array(adminV1PromoCodeSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
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

const adminV1DeleteWorkflowResultSchema = z.object({
  success: z.literal(true),
  workflowId: z.string(),
})

const adminV1WorkflowVersionsResultSchema = z.object({
  versions: z.array(adminV1DeploymentVersionSchema),
})

const adminV1ActivateWorkflowVersionResultSchema = z.object({
  success: z.literal(true),
  version: z.number(),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
})

const adminV1DeleteWorkspaceWorkflowsResultSchema = z.object({
  success: z.literal(true),
  deleted: z.number(),
})

const adminV1WorkspaceMemberMutationResultSchema = adminV1WorkspaceMemberSchema.extend({
  action: z.enum(['created', 'updated', 'already_member']),
})

const adminV1DeleteWorkspaceMemberResultSchema = z.object({
  removed: z.literal(true),
  userId: z.string(),
  workspaceId: z.string(),
})

const adminV1RemoveWorkspaceMemberResultSchema = z.object({
  removed: z.literal(true),
  memberId: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
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

export const adminV1ListAccessControlContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/access-control',
  query: adminV1AccessControlQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1AccessControlListResultSchema),
  },
})

export const adminV1DeleteAccessControlContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/access-control',
  query: adminV1AccessControlDeleteQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1AccessControlDeleteResultSchema),
  },
})

export const adminV1ListReferralCampaignsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/referral-campaigns',
  query: adminV1ReferralCampaignQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ReferralCampaignListResultSchema,
  },
})

export const adminV1CreateReferralCampaignContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/referral-campaigns',
  body: adminV1ReferralCampaignBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1PromoCodeSchema),
  },
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

export const adminV1ListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkflowSchema),
  },
})

export const adminV1GetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkflowDetailSchema),
  },
})

export const adminV1DeleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workflows/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1DeleteWorkflowResultSchema,
  },
})

export const adminV1DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/[id]/deploy',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1DeployResultSchema),
  },
})

export const adminV1UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workflows/[id]/deploy',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1UndeployResultSchema),
  },
})

export const adminV1ListWorkflowVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]/versions',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkflowVersionsResultSchema),
  },
})

export const adminV1ActivateWorkflowVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/[id]/versions/[versionId]/activate',
  params: adminV1WorkflowVersionParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1ActivateWorkflowVersionResultSchema),
  },
})

export const adminV1ExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]/export',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkflowExportPayloadSchema),
  },
})

export const adminV1ExportWorkflowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/export',
  query: adminV1ExportFormatQuerySchema,
  body: adminV1ExportWorkflowsBodySchema,
  response: {
    mode: 'binary',
  },
})

export const adminV1ImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/import',
  body: adminV1WorkflowImportBodySchema,
  response: {
    mode: 'json',
    schema: adminV1WorkflowImportResponseSchema,
  },
})

export const adminV1ListWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkspaceSchema),
  },
})

export const adminV1GetWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceDetailSchema),
  },
})

export const adminV1ListWorkspaceWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/workflows',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkflowSchema),
  },
})

export const adminV1DeleteWorkspaceWorkflowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/workflows',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1DeleteWorkspaceWorkflowsResultSchema,
  },
})

export const adminV1ListWorkspaceFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/folders',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1FolderSchema),
  },
})

export const adminV1ExportWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/export',
  params: adminV1IdParamsSchema,
  query: adminV1ExportFormatQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const adminV1ImportWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workspaces/[id]/import',
  params: adminV1IdParamsSchema,
  query: adminV1WorkspaceImportQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1WorkspaceImportResponseSchema,
  },
})

export const adminV1ListWorkspaceMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkspaceMemberSchema),
  },
})

export const adminV1CreateWorkspaceMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminV1IdParamsSchema,
  body: adminV1WorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceMemberMutationResultSchema),
  },
})

export const adminV1DeleteWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminV1IdParamsSchema,
  query: adminV1DeleteWorkspaceMemberQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1DeleteWorkspaceMemberResultSchema),
  },
})

export const adminV1GetWorkspaceMemberContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminV1WorkspaceMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceMemberSchema),
  },
})

export const adminV1UpdateWorkspaceMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminV1WorkspaceMemberParamsSchema,
  body: adminV1UpdateWorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceMemberSchema),
  },
})

export const adminV1RemoveWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminV1WorkspaceMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1RemoveWorkspaceMemberResultSchema),
  },
})

export const adminV1ExportFolderContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/folders/[id]/export',
  params: adminV1IdParamsSchema,
  query: adminV1ExportFormatQuerySchema,
  response: {
    mode: 'binary',
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

export type AdminV1IdParamsInput = z.input<typeof adminV1IdParamsSchema>
export type AdminV1IdParams = z.output<typeof adminV1IdParamsSchema>
export type AdminV1WorkflowVersionParamsInput = z.input<typeof adminV1WorkflowVersionParamsSchema>
export type AdminV1WorkflowVersionParams = z.output<typeof adminV1WorkflowVersionParamsSchema>
export type AdminV1WorkspaceMemberParamsInput = z.input<typeof adminV1WorkspaceMemberParamsSchema>
export type AdminV1WorkspaceMemberParams = z.output<typeof adminV1WorkspaceMemberParamsSchema>
export type AdminV1PaginationQueryInput = z.input<typeof adminV1PaginationQuerySchema>
export type AdminV1PaginationQuery = z.output<typeof adminV1PaginationQuerySchema>
export type AdminV1ExportFormatQueryInput = z.input<typeof adminV1ExportFormatQuerySchema>
export type AdminV1ExportFormatQuery = z.output<typeof adminV1ExportFormatQuerySchema>
export type AdminV1DeleteWorkspaceMemberQueryInput = z.input<
  typeof adminV1DeleteWorkspaceMemberQuerySchema
>
export type AdminV1DeleteWorkspaceMemberQuery = z.output<
  typeof adminV1DeleteWorkspaceMemberQuerySchema
>
export type AdminV1WorkspaceImportQueryInput = z.input<typeof adminV1WorkspaceImportQuerySchema>
export type AdminV1WorkspaceImportQuery = z.output<typeof adminV1WorkspaceImportQuerySchema>
export type AdminV1WorkspaceMemberBodyInput = z.input<typeof adminV1WorkspaceMemberBodySchema>
export type AdminV1WorkspaceMemberBody = z.output<typeof adminV1WorkspaceMemberBodySchema>
export type AdminV1UpdateWorkspaceMemberBodyInput = z.input<
  typeof adminV1UpdateWorkspaceMemberBodySchema
>
export type AdminV1UpdateWorkspaceMemberBody = z.output<
  typeof adminV1UpdateWorkspaceMemberBodySchema
>
export type AdminV1ExportWorkflowsBodyInput = z.input<typeof adminV1ExportWorkflowsBodySchema>
export type AdminV1ExportWorkflowsBody = z.output<typeof adminV1ExportWorkflowsBodySchema>
export type AdminV1WorkflowImportBodyInput = z.input<typeof adminV1WorkflowImportBodySchema>
export type AdminV1WorkflowImportBody = z.output<typeof adminV1WorkflowImportBodySchema>
export type AdminV1WorkspaceImportBodyInput = z.input<typeof adminV1WorkspaceImportBodySchema>
export type AdminV1WorkspaceImportBody = z.output<typeof adminV1WorkspaceImportBodySchema>
export type AdminV1Workspace = z.output<typeof adminV1WorkspaceSchema>
export type AdminV1WorkspaceDetail = z.output<typeof adminV1WorkspaceDetailSchema>
export type AdminV1Folder = z.output<typeof adminV1FolderSchema>
export type AdminV1Workflow = z.output<typeof adminV1WorkflowSchema>
export type AdminV1WorkflowDetail = z.output<typeof adminV1WorkflowDetailSchema>
export type AdminV1WorkspaceMember = z.output<typeof adminV1WorkspaceMemberSchema>
export type AdminV1WorkflowVariable = z.output<typeof adminV1WorkflowVariableSchema>
export type AdminV1WorkflowExportState = z.output<typeof adminV1WorkflowExportStateSchema>
export type AdminV1WorkflowExportPayload = z.output<typeof adminV1WorkflowExportPayloadSchema>
export type AdminV1FolderExportPayload = z.output<typeof adminV1FolderExportPayloadSchema>
export type AdminV1WorkspaceExportPayload = z.output<typeof adminV1WorkspaceExportPayloadSchema>
export type AdminV1FolderFullExportPayload = z.output<typeof adminV1FolderFullExportPayloadSchema>
export type AdminV1ImportResult = z.output<typeof adminV1ImportResultSchema>
export type AdminV1WorkflowImportResponseBody = z.output<typeof adminV1WorkflowImportResponseSchema>
export type AdminV1WorkspaceImportResponseBody = z.output<
  typeof adminV1WorkspaceImportResponseSchema
>
export type AdminV1DeploymentVersion = z.output<typeof adminV1DeploymentVersionSchema>
export type AdminV1DeployResult = z.output<typeof adminV1DeployResultSchema>
export type AdminV1UndeployResult = z.output<typeof adminV1UndeployResultSchema>
export type AdminV1PermissionGroup = z.output<typeof adminV1PermissionGroupSchema>
export type AdminV1PromoCode = z.output<typeof adminV1PromoCodeSchema>

export type AdminV1ListUsersResponse = ContractJsonResponse<typeof adminV1ListUsersContract>
export type AdminV1GetUserResponse = ContractJsonResponse<typeof adminV1GetUserContract>
export type AdminV1GetUserBillingResponse = ContractJsonResponse<
  typeof adminV1GetUserBillingContract
>
export type AdminV1UpdateUserBillingResponse = ContractJsonResponse<
  typeof adminV1UpdateUserBillingContract
>
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
export type AdminV1ListSubscriptionsResponse = ContractJsonResponse<
  typeof adminV1ListSubscriptionsContract
>
export type AdminV1GetSubscriptionResponse = ContractJsonResponse<
  typeof adminV1GetSubscriptionContract
>
export type AdminV1CancelSubscriptionResponse = ContractJsonResponse<
  typeof adminV1CancelSubscriptionContract
>
export type AdminV1ListAccessControlQueryInput = ContractQueryInput<
  typeof adminV1ListAccessControlContract
>
export type AdminV1ListAccessControlQuery = ContractQuery<typeof adminV1ListAccessControlContract>
export type AdminV1DeleteAccessControlQueryInput = ContractQueryInput<
  typeof adminV1DeleteAccessControlContract
>
export type AdminV1DeleteAccessControlQuery = ContractQuery<
  typeof adminV1DeleteAccessControlContract
>
export type AdminV1ListAccessControlResponse = ContractJsonResponse<
  typeof adminV1ListAccessControlContract
>
export type AdminV1DeleteAccessControlResponse = ContractJsonResponse<
  typeof adminV1DeleteAccessControlContract
>
export type AdminV1ReferralCampaignDuration = ContractBody<
  typeof adminV1CreateReferralCampaignContract
>['duration']
export type AdminV1ReferralCampaignAppliesTo = NonNullable<
  ContractBody<typeof adminV1CreateReferralCampaignContract>['appliesTo']
>[number]
export type AdminV1ListReferralCampaignsQueryInput = ContractQueryInput<
  typeof adminV1ListReferralCampaignsContract
>
export type AdminV1ListReferralCampaignsQuery = ContractQuery<
  typeof adminV1ListReferralCampaignsContract
>
export type AdminV1CreateReferralCampaignBodyInput = ContractBodyInput<
  typeof adminV1CreateReferralCampaignContract
>
export type AdminV1CreateReferralCampaignBody = ContractBody<
  typeof adminV1CreateReferralCampaignContract
>
export type AdminV1ListReferralCampaignsResponse = ContractJsonResponse<
  typeof adminV1ListReferralCampaignsContract
>
export type AdminV1CreateReferralCampaignResponse = ContractJsonResponse<
  typeof adminV1CreateReferralCampaignContract
>
export type AdminV1ListOutboxQueryInput = ContractQueryInput<typeof adminV1ListOutboxContract>
export type AdminV1ListOutboxQuery = ContractQuery<typeof adminV1ListOutboxContract>
export type AdminV1RequeueOutboxEventParams = ContractParams<
  typeof adminV1RequeueOutboxEventContract
>
export type AdminV1ListOutboxResponse = ContractJsonResponse<typeof adminV1ListOutboxContract>
export type AdminV1RequeueOutboxEventResponse = ContractJsonResponse<
  typeof adminV1RequeueOutboxEventContract
>
export type AdminV1ListWorkflowsResponse = ContractJsonResponse<typeof adminV1ListWorkflowsContract>
export type AdminV1GetWorkflowResponse = ContractJsonResponse<typeof adminV1GetWorkflowContract>
export type AdminV1DeleteWorkflowResponse = ContractJsonResponse<
  typeof adminV1DeleteWorkflowContract
>
export type AdminV1DeployWorkflowResponse = ContractJsonResponse<
  typeof adminV1DeployWorkflowContract
>
export type AdminV1UndeployWorkflowResponse = ContractJsonResponse<
  typeof adminV1UndeployWorkflowContract
>
export type AdminV1ListWorkflowVersionsResponse = ContractJsonResponse<
  typeof adminV1ListWorkflowVersionsContract
>
export type AdminV1ActivateWorkflowVersionResponse = ContractJsonResponse<
  typeof adminV1ActivateWorkflowVersionContract
>
export type AdminV1ExportWorkflowResponse = ContractJsonResponse<
  typeof adminV1ExportWorkflowContract
>
export type AdminV1ImportWorkflowResponse = ContractJsonResponse<
  typeof adminV1ImportWorkflowContract
>
export type AdminV1ListWorkspacesResponse = ContractJsonResponse<
  typeof adminV1ListWorkspacesContract
>
export type AdminV1GetWorkspaceResponse = ContractJsonResponse<typeof adminV1GetWorkspaceContract>
export type AdminV1ListWorkspaceWorkflowsResponse = ContractJsonResponse<
  typeof adminV1ListWorkspaceWorkflowsContract
>
export type AdminV1DeleteWorkspaceWorkflowsResponse = ContractJsonResponse<
  typeof adminV1DeleteWorkspaceWorkflowsContract
>
export type AdminV1ListWorkspaceFoldersResponse = ContractJsonResponse<
  typeof adminV1ListWorkspaceFoldersContract
>
export type AdminV1ImportWorkspaceResponse = ContractJsonResponse<
  typeof adminV1ImportWorkspaceContract
>
export type AdminV1ListWorkspaceMembersResponse = ContractJsonResponse<
  typeof adminV1ListWorkspaceMembersContract
>
export type AdminV1CreateWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1CreateWorkspaceMemberContract
>
export type AdminV1DeleteWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1DeleteWorkspaceMemberContract
>
export type AdminV1GetWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1GetWorkspaceMemberContract
>
export type AdminV1UpdateWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1UpdateWorkspaceMemberContract
>
export type AdminV1RemoveWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1RemoveWorkspaceMemberContract
>
