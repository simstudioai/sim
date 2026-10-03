import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationMetaSchema,
  adminV1PaginationQuerySchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
import { MAX_INVITE_EMAILS, MAX_INVITE_WORKSPACES } from '@/lib/invitations/limits'

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
  usageDollars: dollarAmountSchema,
  usageCredits: z.number().int().min(0),
  workflowRuns: z.number().int().min(0),
})

const adminDashboardBillingIntervalSchema = z.enum(['month', 'year'])
const adminDashboardReportingPeriodSchema = z.object({
  anchorDate: z.string().nullable(),
  interval: adminDashboardBillingIntervalSchema.nullable(),
  currentStart: z.string(),
  currentEnd: z.string(),
  source: z.enum(['reporting', 'stripe', 'default']),
})
const adminDashboardUsageSchema = z.object({
  usedDollars: dollarAmountSchema,
  limitDollars: dollarAmountSchema,
  usedCredits: z.number().int().min(0),
  limitCredits: z.number().int().min(0),
  workflowRuns: z.number().int().min(0),
})
const adminDashboardWorkspaceMoveProgressSchema = z.object({
  selected: z.number().int().min(0),
  moved: z.number().int().min(0),
  pending: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  failed: z.array(
    z.object({ eventId: z.string(), workspaceId: z.string(), error: z.string().nullable() })
  ),
})
const adminDashboardInvitationSpecSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['admin', 'member']).default('member'),
  permission: z.enum(['admin', 'write', 'read']).default('write'),
})
const adminDashboardInvitationProgressSchema = z.object({
  selected: z.number().int().min(0),
  completed: z.number().int().min(0),
  pending: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  failed: z.array(
    z.object({ eventId: z.string(), email: z.string().email(), error: z.string().nullable() })
  ),
})
const adminDashboardFollowUpProgressSchema = z.object({
  selected: z.number().int().min(0),
  completed: z.number().int().min(0),
  pending: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  failed: z.array(
    z.object({
      eventId: z.string(),
      kind: z.enum([
        'member_reconciliation',
        'personal_subscription_cancellation',
        'migrated_invitation_email',
        'workspace_added_email',
      ]),
      subjectId: z.string(),
      error: z.string().nullable(),
    })
  ),
})

const adminDashboardDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const adminDashboardInvoiceAmountSchema = z.number().min(0.01).max(10_000_000).multipleOf(0.01)

export const adminDashboardProvisioningSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  organizationId: z.string(),
  status: z.enum(['pending', 'processing', 'dead_letter', 'awaiting_webhook', 'applied']),
  invoiceAmountUsd: z.number(),
  billingInterval: adminDashboardBillingIntervalSchema,
  reportingPeriodAnchorDate: z.string().nullable(),
  usageLimitDollars: creditAlignedDollarAmountSchema,
  seats: z.number().int().positive(),
  concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT),
  workflowExecutionTimeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS),
  pausePaymentCollection: z.boolean(),
  stripeSubscriptionId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workspaceMoves: adminDashboardWorkspaceMoveProgressSchema,
  invitations: adminDashboardInvitationProgressSchema,
  followUpJobs: adminDashboardFollowUpProgressSchema,
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
  workflowExecutionTimeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
    .nullable(),
  planAllowanceDollars: dollarAmountSchema.nullable(),
  usageLimitDollars: dollarAmountSchema,
  effectiveUsageLimitDollars: dollarAmountSchema,
  prepaidBalanceDollars: dollarAmountSchema,
  invoiceAmountUsd: z.number().nullable(),
  billingInterval: adminDashboardBillingIntervalSchema.nullable(),
  reportingPeriod: adminDashboardReportingPeriodSchema,
  usage: adminDashboardUsageSchema,
  provisioning: adminDashboardProvisioningSchema.nullable(),
})

export const adminDashboardOrganizationDetailSchema =
  adminDashboardOrganizationSummarySchema.extend({
    configurationUpdate: z
      .object({
        id: z.string(),
        status: z.enum(['pending', 'processing', 'failed']),
        requestedUsageLimitDollars: dollarAmountSchema.nullable(),
        requestedReportingPeriodInterval: adminDashboardBillingIntervalSchema.nullable(),
        requestedReportingPeriodAnchorDate: adminDashboardDateOnlySchema.nullable(),
        requestedSeats: z.number().int().positive().nullable(),
        requestedConcurrencyLimit: z
          .number()
          .int()
          .positive()
          .max(MAX_BILLING_CONCURRENCY_LIMIT)
          .nullable(),
        requestedWorkflowExecutionTimeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
          .nullable(),
        providerAccepted: z.boolean(),
        retryable: z.boolean(),
        error: z.string().nullable(),
      })
      .nullable(),
    historicalActorUsage: z.object({
      usedDollars: dollarAmountSchema,
      usedCredits: z.number().int().min(0),
      workflowRuns: z.number().int().min(0),
      actorCount: z.number().int().min(0),
    }),
    members: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.string(),
        usageLimitDollars: dollarAmountSchema.nullable(),
        usageDollars: dollarAmountSchema,
        usageCredits: z.number().int().min(0),
        workflowRuns: z.number().int().min(0),
      })
    ),
    externalCollaborators: z.array(
      z.object({
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        workspaceCount: z.number().int().min(1),
        usageLimitDollars: dollarAmountSchema.nullable(),
        usageDollars: dollarAmountSchema,
        usageCredits: z.number().int().min(0),
        workflowRuns: z.number().int().min(0),
      })
    ),
    workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
    memberPagination: adminV1PaginationMetaSchema,
    externalCollaboratorPagination: adminV1PaginationMetaSchema,
    workspacePagination: adminV1PaginationMetaSchema,
    subscription: z
      .object({
        id: z.string(),
        plan: z.string(),
        status: z.string().nullable(),
        cancelAtPeriodEnd: z.boolean().nullable(),
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

export const adminDashboardOrganizationDetailQuerySchema = z.object({
  limit: adminV1PaginationQuerySchema.shape.limit.default(50),
  memberOffset: adminV1PaginationQuerySchema.shape.offset.default(0),
  externalCollaboratorOffset: adminV1PaginationQuerySchema.shape.offset.default(0),
  workspaceOffset: adminV1PaginationQuerySchema.shape.offset.default(0),
})

export const adminDashboardIssueEnterpriseBodySchema = z
  .object({
    ownerUserId: z.string().min(1),
    organizationName: z.string().trim().min(1).max(120).optional(),
    invoiceAmountUsd: adminDashboardInvoiceAmountSchema,
    billingInterval: adminDashboardBillingIntervalSchema.default('year'),
    reportingPeriodAnchorDate: adminDashboardDateOnlySchema.optional(),
    workspaceIds: z.array(z.string().min(1)).max(1_000).default([]),
    invitations: z.array(adminDashboardInvitationSpecSchema).max(MAX_INVITE_EMAILS).default([]),
    usageLimitDollars: creditAlignedDollarAmountSchema.optional(),
    seats: z.number().int().positive().max(100_000),
    concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT).optional(),
    workflowExecutionTimeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
      .optional(),
    pausePaymentCollection: z.boolean().optional(),
  })
  .strict()

export const adminDashboardEnterpriseOwnerClaimBodySchema = z
  .object({
    ownerEmail: z.string().trim().email(),
    organizationName: z.string().trim().min(1).max(120),
    invoiceAmountUsd: adminDashboardInvoiceAmountSchema,
    billingInterval: adminDashboardBillingIntervalSchema.default('year'),
    invitations: z.array(adminDashboardInvitationSpecSchema).max(MAX_INVITE_EMAILS).default([]),
    usageLimitDollars: creditAlignedDollarAmountSchema.optional(),
    seats: z.number().int().positive().max(100_000),
    concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT).optional(),
    workflowExecutionTimeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
      .optional(),
    pausePaymentCollection: z.boolean().optional(),
  })
  .strict()

const adminDashboardEnterpriseOwnerClaimSchema = z.object({
  id: z.string(),
  ownerEmail: z.string().email(),
  organizationName: z.string(),
  organizationId: z.string().nullable(),
  provisioningOperationId: z.string().nullable(),
  stage: z.enum([
    'owner_email',
    'owner_acceptance',
    'activation',
    'stripe_provisioning',
    'complete',
  ]),
  status: z.enum([
    'sending',
    'awaiting_owner',
    'activating',
    'provisioning',
    'applied',
    'failed',
    'expired',
    'revoked',
  ]),
  error: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const adminDashboardEnterpriseOwnerClaimReviewSchema = z.object({
  ownerEmail: z.string().email(),
  organizationName: z.string(),
  activationTiming: z.literal('after_owner_acceptance'),
  invoiceAmountUsd: adminDashboardInvoiceAmountSchema,
  billingInterval: adminDashboardBillingIntervalSchema,
  usageLimitCredits: z.number().int().nonnegative(),
  invitations: z.object({ requested: z.number().int().min(0).max(MAX_INVITE_EMAILS) }),
  workspaces: z.object({ resolvedAtAcceptance: z.literal(true) }),
  seats: z.object({
    ownerSeats: z.literal(1),
    newInvitationSeats: z.number().int().min(0).max(MAX_INVITE_EMAILS),
    requiredSeats: z.number().int().positive(),
    capacity: z.number().int().positive().max(100_000),
    sufficient: z.boolean(),
  }),
})

export const adminDashboardSeatsBodySchema = z.object({
  seats: z.number().int().positive().max(100_000),
})

export const adminDashboardRenameOrganizationBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export const adminDashboardInvitePeopleBodySchema = z.object({
  operationId: z.string().uuid(),
  emails: z.array(z.string().trim().email()).min(1).max(MAX_INVITE_EMAILS),
  workspaceIds: z.array(z.string().min(1)).min(1).max(MAX_INVITE_WORKSPACES),
  role: z.enum(['admin', 'member']).default('member'),
  permission: z.enum(['admin', 'write', 'read']).default('write'),
})

export const adminDashboardCancelSubscriptionBodySchema = z.object({
  operationId: z.string().uuid(),
  timing: z.enum(['period_end', 'immediate']).default('period_end'),
  reason: z.string().trim().min(1).max(500).optional(),
})

export const adminDashboardRefundBodySchema = z.object({
  operationId: z.string().uuid(),
  chargeId: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
  note: z.string().trim().min(1).max(500).optional(),
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
    workflowExecutionTimeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      value.usageLimitDollars !== undefined ||
      value.concurrencyLimit !== undefined ||
      value.workflowExecutionTimeoutSeconds !== undefined,
    { error: 'At least one limit must be provided' }
  )

export const adminDashboardBalanceGrantBodySchema = z.object({
  operationId: z.string().uuid(),
  amountDollars: positiveCreditAlignedDollarAmountSchema,
  reason: z.string().trim().min(1).max(500).optional(),
})

export const adminDashboardAddMemberBodySchema = z.object({
  operationId: z.string().uuid(),
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
  usageLimitDollars: dollarAmountSchema.nullable().optional(),
  personalWorkspaceIds: z.array(z.string().min(1)).max(1_000).default([]),
})

export const adminDashboardMemberPreflightQuerySchema = adminDashboardSearchQuerySchema.extend({
  userId: z.string().min(1),
  limit: adminV1PaginationQuerySchema.shape.limit.default(50),
  offset: adminV1PaginationQuerySchema.shape.offset.default(0),
})

export const adminDashboardMemberPreflightSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  currentOrganization: z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
  personalWorkspaces: z.array(
    z.object({ id: z.string(), name: z.string(), archived: z.boolean() })
  ),
  workspacePagination: adminV1PaginationMetaSchema,
  workspaceSelection: z
    .object({
      totalEligible: z.number().int().min(0),
      defaultSelectedIds: z.array(z.string().min(1)).max(1_000),
      defaultSelectedWorkspaces: z
        .array(z.object({ id: z.string(), name: z.string(), archived: z.boolean() }))
        .max(1_000),
      includesAllEligible: z.boolean(),
      limit: z.literal(1_000),
    })
    .superRefine((selection, context) => {
      const validCompleteSelection =
        selection.includesAllEligible &&
        selection.totalEligible <= selection.limit &&
        selection.defaultSelectedIds.length === selection.totalEligible &&
        selection.defaultSelectedWorkspaces.length === selection.totalEligible
      const validBoundedSelection =
        !selection.includesAllEligible &&
        selection.totalEligible > selection.limit &&
        selection.defaultSelectedIds.length === 0 &&
        selection.defaultSelectedWorkspaces.length === 0
      if (!validCompleteSelection && !validBoundedSelection) {
        context.addIssue({
          code: 'custom',
          message: 'Default workspace selection must be complete or explicitly empty above limit',
        })
      }
    }),
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

export const adminDashboardEnterprisePreflightQuerySchema = adminDashboardSearchQuerySchema.extend({
  ownerUserId: z.string().min(1),
  limit: adminV1PaginationQuerySchema.shape.limit.default(50),
  offset: adminV1PaginationQuerySchema.shape.offset.default(0),
  invoiceAmountUsd: z.coerce.number().min(0.01).max(10_000_000).multipleOf(0.01).optional(),
  billingInterval: adminDashboardBillingIntervalSchema.optional(),
  reportingPeriodAnchorDate: adminDashboardDateOnlySchema.optional(),
  usageLimitDollars: z.coerce
    .number()
    .finite()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER / 200)
    .refine((value) => Math.abs(value * 200 - Math.round(value * 200)) < 1e-8, {
      error: 'Dollar amounts must use $0.005 increments',
    })
    .optional(),
})

export const adminDashboardEnterprisePreflightSchema = z.object({
  owner: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  organization: z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
  personalWorkspaces: z.array(
    z.object({ id: z.string(), name: z.string(), archived: z.boolean() })
  ),
  workspacePagination: adminV1PaginationMetaSchema,
  workspaceSelection: z
    .object({
      totalEligible: z.number().int().min(0),
      defaultSelectedIds: z.array(z.string().min(1)).max(1_000),
      defaultSelectedWorkspaces: z
        .array(z.object({ id: z.string(), name: z.string(), archived: z.boolean() }))
        .max(1_000),
      includesAllEligible: z.boolean(),
      limit: z.literal(1_000),
    })
    .superRefine((selection, context) => {
      const validCompleteSelection =
        selection.includesAllEligible &&
        selection.totalEligible <= selection.limit &&
        selection.defaultSelectedIds.length === selection.totalEligible &&
        selection.defaultSelectedWorkspaces.length === selection.totalEligible
      const validOverLimitSelection =
        !selection.includesAllEligible &&
        selection.totalEligible > selection.limit &&
        selection.defaultSelectedIds.length === 0 &&
        selection.defaultSelectedWorkspaces.length === 0
      if (!validCompleteSelection && !validOverLimitSelection) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Default workspace selection must be complete or explicitly empty when over limit',
          path: ['defaultSelectedIds'],
        })
      }
    }),
  billingPreview: z
    .object({
      reportingPeriod: adminDashboardReportingPeriodSchema,
      usage: adminDashboardUsageSchema,
      invoiceAmountUsd: adminDashboardInvoiceAmountSchema,
      configuredUsageLimitDollars: dollarAmountSchema,
      prepaidBalanceDollars: dollarAmountSchema,
      effectiveUsageLimitDollars: dollarAmountSchema,
      exceedsLimit: z.boolean(),
    })
    .nullable(),
  canIssue: z.boolean(),
  reason: z.string().nullable(),
})

export const adminDashboardEnterpriseReviewSchema = z.object({
  owner: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  organization: z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
  billingPreview: z.object({
    reportingPeriod: adminDashboardReportingPeriodSchema,
    usage: adminDashboardUsageSchema,
    invoiceAmountUsd: adminDashboardInvoiceAmountSchema,
    configuredUsageLimitDollars: dollarAmountSchema,
    prepaidBalanceDollars: dollarAmountSchema,
    effectiveUsageLimitDollars: dollarAmountSchema,
    exceedsLimit: z.boolean(),
  }),
  workspaceSelection: z.object({ selected: z.number().int().min(0).max(1_000) }),
  invitations: z.object({
    requested: z.number().int().min(0).max(MAX_INVITE_EMAILS),
    additionalSeatReservationsFromWorkspaceSweep: z.number().int().min(0).max(100_000),
  }),
  seats: z.object({
    memberSeats: z.number().int().min(0),
    pendingSeats: z.number().int().min(0),
    migratedPendingSeats: z.number().int().min(0).max(100_000),
    newInvitationSeats: z.number().int().min(0).max(MAX_INVITE_EMAILS),
    requiredSeats: z.number().int().min(0),
    capacity: z.number().int().positive().max(100_000),
    sufficient: z.boolean(),
  }),
})

export const adminDashboardReportingPeriodBodySchema = z.object({
  reportingPeriodInterval: adminDashboardBillingIntervalSchema,
  reportingPeriodAnchorDate: adminDashboardDateOnlySchema,
})

export const adminDashboardReportingPeriodPreviewSchema = z.object({
  reportingPeriod: adminDashboardReportingPeriodSchema,
  usage: adminDashboardUsageSchema,
  exceedsLimit: z.boolean(),
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

export const adminDashboardRetryConfigurationUpdateBodySchema = z.object({
  operationId: z.string().min(1),
})

const adminDashboardMutationResultSchema = z.object({ success: z.literal(true) })
const adminDashboardBalanceGrantResultSchema = adminDashboardMutationResultSchema.extend({
  prepaidBalanceDollars: dollarAmountSchema,
  usageLimitDollars: dollarAmountSchema,
})
const adminDashboardMemberOperationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  userId: z.string(),
  status: z.enum(['pending', 'processing', 'dead_letter', 'applied']),
  memberId: z.string().nullable(),
  transferredFromOrganizationId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  workspaceMoves: z.object({
    selected: z.number().int().min(0).max(1_000),
    moved: z.number().int().min(0).max(1_000),
    pending: z.number().int().min(0).max(1_000),
    failedCount: z.number().int().min(0).max(1),
    failed: z.array(z.object({ workspaceId: z.string(), error: z.string() })).max(1),
  }),
  followUpJobs: adminDashboardFollowUpProgressSchema,
})
const adminDashboardInvitationOperationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  status: z.enum(['pending', 'processing', 'dead_letter', 'applied']),
  error: z.string().nullable(),
  createdAt: z.string(),
  invitations: z.object({
    selected: z.number().int().min(1).max(MAX_INVITE_EMAILS),
    completed: z.number().int().min(0).max(MAX_INVITE_EMAILS),
    pending: z.number().int().min(0).max(MAX_INVITE_EMAILS),
    failedCount: z.number().int().min(0).max(MAX_INVITE_EMAILS),
    sent: z.array(z.string().email()).max(MAX_INVITE_EMAILS),
    added: z.array(z.string().email()).max(MAX_INVITE_EMAILS),
    unchanged: z.array(z.string().email()).max(MAX_INVITE_EMAILS),
    failed: z
      .array(
        z.object({ eventId: z.string(), email: z.string().email(), error: z.string().nullable() })
      )
      .max(MAX_INVITE_EMAILS),
  }),
  notifications: z.object({
    selected: z.number().int().min(0),
    completed: z.number().int().min(0),
    pending: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    failed: z
      .array(
        z.object({
          eventId: z.string(),
          email: z.string().email(),
          workspaceId: z.string(),
          error: z.string().nullable(),
        })
      )
      .max(100),
  }),
})
const adminDashboardBillingActionsSchema = z.object({
  subscription: z.object({
    id: z.string(),
    stripeSubscriptionId: z.string(),
    status: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    periodEnd: z.string().nullable(),
  }),
  cancellationSync: z
    .object({
      operationId: z.string().uuid(),
      timing: z.enum(['period_end', 'immediate']),
      status: z.enum(['pending', 'processing', 'applied', 'failed']),
      error: z.string().nullable(),
    })
    .nullable(),
  refundHistoryLimited: z.boolean(),
  refundablePayments: z.array(
    z.object({
      chargeId: z.string(),
      amountCents: z.number().int().nonnegative(),
      refundedCents: z.number().int().nonnegative(),
      refundableCents: z.number().int().nonnegative(),
      currency: z.string(),
      createdAt: z.string(),
      invoiceId: z.string().nullable(),
      description: z.string().nullable(),
    })
  ),
})
const adminDashboardCancellationResultSchema = z.object({
  success: z.literal(true),
  operationId: z.string(),
  status: z.enum(['pending', 'processing', 'applied', 'failed']),
})
const adminDashboardRefundResultSchema = z.object({
  success: z.literal(true),
  refundId: z.string(),
  status: z.string().nullable(),
  outcome: z.enum(['applied', 'pending', 'failed']),
  amountCents: z.number().int().positive(),
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
  query: adminDashboardOrganizationDetailQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardOrganizationDetailSchema),
  },
})

export const adminDashboardRenameOrganizationContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/dashboard/organizations/[id]',
  params: adminV1IdParamsSchema,
  body: adminDashboardRenameOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
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

export const adminDashboardCreateEnterpriseOwnerClaimContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-owner-claims',
  body: adminDashboardEnterpriseOwnerClaimBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardEnterpriseOwnerClaimSchema),
  },
})

export const adminDashboardListEnterpriseOwnerClaimsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/enterprise-owner-claims',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminDashboardEnterpriseOwnerClaimSchema),
  },
})

export const adminDashboardReviewEnterpriseOwnerClaimContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-owner-claims/review',
  body: adminDashboardEnterpriseOwnerClaimBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardEnterpriseOwnerClaimReviewSchema),
  },
})

export const adminDashboardRetryEnterpriseOwnerClaimContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-owner-claims/[id]/retry',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardEnterpriseOwnerClaimSchema),
  },
})

export const adminDashboardRevokeEnterpriseOwnerClaimContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-owner-claims/[id]/revoke',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardEnterpriseOwnerClaimSchema),
  },
})

export const adminDashboardEnterprisePreflightContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/enterprise-provisioning/preflight',
  query: adminDashboardEnterprisePreflightQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardEnterprisePreflightSchema),
  },
})

export const adminDashboardEnterpriseReviewContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-provisioning/review',
  body: adminDashboardIssueEnterpriseBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardEnterpriseReviewSchema),
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

export const adminDashboardRetryEnterpriseWorkspaceMoveContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-provisioning/[id]/workspace-moves/[moveId]/retry',
  params: adminV1IdParamsSchema.extend({ moveId: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardProvisioningSchema),
  },
})

export const adminDashboardRetryEnterpriseInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-provisioning/[id]/invitations/[inviteId]/retry',
  params: adminV1IdParamsSchema.extend({ inviteId: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardProvisioningSchema),
  },
})

export const adminDashboardRetryEnterpriseFollowUpJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/enterprise-provisioning/[id]/follow-up-jobs/[jobId]/retry',
  params: adminV1IdParamsSchema.extend({ jobId: z.string().min(1) }),
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

export const adminDashboardPreviewReportingPeriodContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/reporting-period/preview',
  params: adminV1IdParamsSchema,
  body: adminDashboardReportingPeriodBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardReportingPeriodPreviewSchema),
  },
})

export const adminDashboardUpdateReportingPeriodContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/dashboard/organizations/[id]/reporting-period',
  params: adminV1IdParamsSchema,
  body: adminDashboardReportingPeriodBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMutationResultSchema),
  },
})

export const adminDashboardRetryConfigurationUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/configuration-update/retry',
  params: adminV1IdParamsSchema,
  body: adminDashboardRetryConfigurationUpdateBodySchema,
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
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMemberOperationSchema),
  },
})

export const adminDashboardMemberOperationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/organizations/[id]/member-operations/[operationId]',
  params: adminV1IdParamsSchema.extend({ operationId: z.string().uuid() }),
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMemberOperationSchema),
  },
})

export const adminDashboardRetryMemberFollowUpJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/member-operations/[operationId]/follow-up-jobs/[jobId]/retry',
  params: adminV1IdParamsSchema.extend({
    operationId: z.string().uuid(),
    jobId: z.string().min(1),
  }),
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardMemberOperationSchema),
  },
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

export const adminDashboardInvitePeopleContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/invitations',
  params: adminV1IdParamsSchema,
  body: adminDashboardInvitePeopleBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardInvitationOperationSchema),
  },
})

export const adminDashboardGetInvitationOperationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/organizations/[id]/invitation-operations/[operationId]',
  params: adminV1IdParamsSchema.extend({ operationId: z.string().uuid() }),
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardInvitationOperationSchema),
  },
})

export const adminDashboardRetryInvitationOperationJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/invitation-operations/[operationId]/jobs/[jobId]/retry',
  params: adminV1IdParamsSchema.extend({
    operationId: z.string().uuid(),
    jobId: z.string().min(1),
  }),
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardInvitationOperationSchema),
  },
})

export const adminDashboardBillingActionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/organizations/[id]/billing-actions',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardBillingActionsSchema),
  },
})

export const adminDashboardCancelSubscriptionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/cancellation',
  params: adminV1IdParamsSchema,
  body: adminDashboardCancelSubscriptionBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardCancellationResultSchema),
  },
})

export const adminDashboardRefundContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/organizations/[id]/refunds',
  params: adminV1IdParamsSchema,
  body: adminDashboardRefundBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminDashboardRefundResultSchema),
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
