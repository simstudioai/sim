import { AuditAction, AuditResourceType, recordAudit, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  outboxEvent,
  permissions,
  subscription,
  user,
  workspace,
} from '@sim/db/schema'
import { isOrgAdminRole, permissionSatisfies } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { normalizeEmail, slugify } from '@sim/utils/string'
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import type Stripe from 'stripe'
import {
  ADMIN_INVITATION_OPERATION_EVENT_TYPE,
  parseAdminInvitationOperationPayload,
} from '@/lib/admin/invitation-operation'
import { parseBillingConcurrencyLimit } from '@/lib/billing/concurrency-defaults'
import { getBillingConcurrencyLimit } from '@/lib/billing/concurrency-limits'
import { resolveEnterpriseReportingPeriod } from '@/lib/billing/core/reporting-period'
import {
  getBillingPeriodUsageCost,
  getBillingPeriodWorkflowRunCount,
} from '@/lib/billing/core/usage-log'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  deriveEnterpriseOperationStatus,
  ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE,
  ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE,
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE,
  ENTERPRISE_PROVISION_EVENT_TYPE,
  ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE,
  type EnterpriseInvitePeoplePayload,
  type EnterpriseMetadataSyncPayload,
  type EnterpriseOperationStatus,
  type EnterpriseProvisionPayload,
  type EnterpriseProvisionRequest,
  enterpriseInvitePeoplePayloadSchema,
  enterpriseMemberReconciliationPayloadSchema,
  enterpriseMetadataIntentMatchesStripeSubscription,
  enterpriseMetadataIntentProviderAccepted,
  enterpriseMetadataSyncPayloadSchema,
  enterpriseProvisionPayloadSchema,
  enterpriseWorkspaceMovePayloadSchema,
  parseEnterpriseProvisionPayload,
} from '@/lib/billing/enterprise-outbox'
import {
  parseWorkflowExecutionTimeoutSeconds,
  resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds,
} from '@/lib/billing/execution-timeout-defaults'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import {
  acquireOrganizationMutationLock,
  reapplyPaidOrgJoinBillingForExistingMemberTx,
} from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { TERMINAL_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { countPendingSeatInvitations } from '@/lib/billing/validation/seat-management'
import { withEnterpriseReconciliationLease } from '@/lib/billing/webhooks/enterprise-reconciliation-lease'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { env } from '@/lib/core/config/env'
import {
  continueOutboxHandler,
  deferOutboxHandler,
  enqueueOutboxEvent,
  type OutboxEventContext,
  type OutboxHandler,
  outboxEventHasSourceOperationId,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { DIRECT_GRANT_EMAIL_EVENT_TYPE } from '@/lib/invitations/direct-grant-event'
import { MAX_INVITE_EMAILS, MAX_INVITE_WORKSPACES } from '@/lib/invitations/limits'
import { sendInvitationEmail } from '@/lib/invitations/send'
import {
  createWorkspaceInvitation,
  prepareWorkspaceInvitationContext,
} from '@/lib/invitations/workspace-invitations'
import {
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE,
  moveWorkspaceToOrganization,
} from '@/lib/workspaces/admin-move'
import { ownedAttachableWorkspacesWhere } from '@/lib/workspaces/organization-workspaces'

const TERMINAL_STATUSES = new Set<string>(TERMINAL_SUBSCRIPTION_STATUSES)
const ENTERPRISE_WEBHOOK_ACKNOWLEDGEMENT_GRACE_MS = 30 * 60 * 1000
const ENTERPRISE_WEBHOOK_ACKNOWLEDGEMENT_POLL_MS = 30 * 1000
export const MAX_ENTERPRISE_WORKSPACE_SELECTION = 1_000
const MAX_ENTERPRISE_MIGRATED_INVITATION_EMAILS = 10_000
const MAX_ENTERPRISE_PROVISIONING_LOOKUP_ORGANIZATIONS = 250
const ENTERPRISE_MEMBER_RECONCILIATION_BATCH_SIZE = 50
const MAX_ENTERPRISE_FOLLOW_UP_FAILURE_DETAILS = 100

const ENTERPRISE_FOLLOW_UP_EVENT_TYPES = [
  ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE,
  OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE,
  DIRECT_GRANT_EMAIL_EVENT_TYPE,
] as const

async function waitForEnterpriseWebhookAcknowledgement(
  acknowledgement: { startedAt: string; deadlineAt: string } | undefined,
  context: OutboxEventContext
) {
  let durableAcknowledgement = acknowledgement
  if (!durableAcknowledgement) {
    const startedAt = new Date()
    durableAcknowledgement = {
      startedAt: startedAt.toISOString(),
      deadlineAt: new Date(
        startedAt.getTime() + ENTERPRISE_WEBHOOK_ACKNOWLEDGEMENT_GRACE_MS
      ).toISOString(),
    }
    await context.checkpointPayload({ acknowledgement: durableAcknowledgement })
  }

  const remainingGraceMs = new Date(durableAcknowledgement.deadlineAt).getTime() - Date.now()
  if (remainingGraceMs > 0) {
    return deferOutboxHandler(
      'Waiting for the verified Stripe webhook acknowledgement',
      Math.min(ENTERPRISE_WEBHOOK_ACKNOWLEDGEMENT_POLL_MS, remainingGraceMs),
      false
    )
  }

  return deferOutboxHandler(
    'Verified Stripe webhook acknowledgement was not received before the acknowledgement deadline'
  )
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? (value as Record<string, unknown>) : {}
}

function isNonterminalSubscriptionStatus(status: string | null | undefined): boolean {
  return !status || !TERMINAL_STATUSES.has(status)
}

function subscriptionOrganizationId(metadata: unknown): string | null {
  const record = metadataRecord(metadata)
  const value = record.referenceId ?? record.organizationId
  return typeof value === 'string' && value.length > 0 ? value : null
}

function subscriptionOperationId(metadata: unknown): string | null {
  const value = metadataRecord(metadata).enterpriseOperationId
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function inspectLocalOrganizationSubscriptions(params: {
  organizationId: string
  operationId: string
  expectedStripeSubscriptionId: string | null
}): Promise<string | null> {
  const rows = await db
    .select({
      status: subscription.status,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      metadata: subscription.metadata,
    })
    .from(subscription)
    .where(eq(subscription.referenceId, params.organizationId))

  let recoveredStripeSubscriptionId: string | null = null
  for (const row of rows) {
    const belongsToOperation = subscriptionOperationId(row.metadata) === params.operationId
    const isExpected =
      Boolean(params.expectedStripeSubscriptionId) &&
      row.stripeSubscriptionId === params.expectedStripeSubscriptionId

    if (belongsToOperation || isExpected) {
      if (
        row.stripeSubscriptionId &&
        recoveredStripeSubscriptionId &&
        recoveredStripeSubscriptionId !== row.stripeSubscriptionId
      ) {
        throw new Error('Multiple Stripe subscriptions exist for this Enterprise operation')
      }
      recoveredStripeSubscriptionId = row.stripeSubscriptionId ?? recoveredStripeSubscriptionId
      continue
    }

    if (isNonterminalSubscriptionStatus(row.status)) {
      throw new Error('Organization already has a different nonterminal subscription')
    }
  }
  return recoveredStripeSubscriptionId
}

async function inspectStripeOrganizationSubscriptions(params: {
  stripe: Stripe
  customerId: string
  organizationId: string
  operationId: string
  expectedStripeSubscriptionId: string | null
}): Promise<Stripe.Subscription | null> {
  let matching: Stripe.Subscription | null = null
  let startingAfter: string | undefined

  for (;;) {
    const page = await params.stripe.subscriptions.list({
      customer: params.customerId,
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const candidate of page.data) {
      const belongsToOperation = candidate.metadata?.enterpriseOperationId === params.operationId
      const isExpected = candidate.id === params.expectedStripeSubscriptionId
      if (belongsToOperation || isExpected) {
        if (matching && matching.id !== candidate.id) {
          throw new Error('Multiple Stripe subscriptions exist for this Enterprise operation')
        }
        matching = candidate
        continue
      }
      if (
        subscriptionOrganizationId(candidate.metadata) === params.organizationId &&
        isNonterminalSubscriptionStatus(candidate.status)
      ) {
        throw new Error('Organization already has a different nonterminal Stripe subscription')
      }
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter) break
  }

  if (params.expectedStripeSubscriptionId && !matching) {
    throw new Error('Recorded Stripe subscription could not be recovered')
  }
  return matching
}

async function findOperationCustomer(
  stripe: Stripe,
  email: string,
  operationId: string
): Promise<Stripe.Customer | null> {
  let match: Stripe.Customer | null = null
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.customers.list({
      email,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const candidate of page.data) {
      if (candidate.metadata?.enterpriseOperationId !== operationId) continue
      if (match && match.id !== candidate.id) {
        throw new Error('Multiple Stripe customers exist for this Enterprise operation')
      }
      match = candidate
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter) break
  }
  return match
}

async function findOperationPrice(
  stripe: Stripe,
  productId: string,
  operationId: string
): Promise<Stripe.Price | null> {
  let match: Stripe.Price | null = null
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.prices.list({
      product: productId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const candidate of page.data) {
      if (candidate.metadata?.enterpriseOperationId !== operationId) continue
      if (match && match.id !== candidate.id) {
        throw new Error('Multiple Stripe prices exist for this Enterprise operation')
      }
      match = candidate
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter) break
  }
  return match
}

function isStripeMissingResource(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'resource_missing'
  )
}

async function retrieveOperationProduct(
  stripe: Stripe,
  operationId: string
): Promise<Stripe.Product | null> {
  const productId = `prod_sim_enterprise_${operationId.replace(/[^a-zA-Z0-9]/g, '')}`
  try {
    const product = await stripe.products.retrieve(productId, { expand: ['default_price'] })
    if (product.metadata?.enterpriseOperationId !== operationId) {
      throw new Error('Recovered Stripe product belongs to a different Enterprise operation')
    }
    return product
  } catch (error) {
    if (isStripeMissingResource(error)) return null
    throw error
  }
}

function assertEnterprisePrice(
  price: Stripe.Price,
  request: EnterpriseProvisionRequest,
  operationId: string,
  expectedProductId: string
): void {
  const productId = typeof price.product === 'string' ? price.product : price.product?.id
  if (
    price.currency !== 'usd' ||
    price.unit_amount !== request.invoiceAmountCents ||
    price.recurring?.interval !== request.billingInterval ||
    (price.recurring.interval_count ?? 1) !== 1 ||
    price.metadata?.enterpriseOperationId !== operationId ||
    productId !== expectedProductId
  ) {
    throw new Error('Recovered Stripe price does not match the Enterprise request')
  }
}

export interface IssueEnterpriseProvisioningInput {
  ownerUserId: string
  organizationName?: string
  invoiceAmountUsd: number
  billingInterval?: 'month' | 'year'
  reportingPeriodAnchorDate?: string
  workspaceIds?: string[]
  invitations?: Array<{
    email: string
    role: 'admin' | 'member'
    permission: 'admin' | 'write' | 'read'
  }>
  usageLimitCredits?: number
  seats: number
  concurrencyLimit?: number
  workflowExecutionTimeoutSeconds?: number
  pausePaymentCollection?: boolean
  requestedByEmail: string
  requestedByUserId: string | null
  requestedByName?: string
}

export interface EnterpriseProvisioningView {
  id: string
  ownerUserId: string
  organizationId: string
  status: EnterpriseOperationStatus
  invoiceAmountUsd: number
  billingInterval: 'month' | 'year'
  reportingPeriodAnchorDate: string | null
  usageLimitCredits: number
  seats: number
  concurrencyLimit: number
  workflowExecutionTimeoutSeconds: number
  pausePaymentCollection: boolean
  stripeSubscriptionId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  workspaceMoves: EnterpriseWorkspaceMoveProgress
  invitations: EnterpriseInvitationProgress
  followUpJobs: EnterpriseFollowUpProgress
}

export interface EnterpriseWorkspaceMoveProgress {
  selected: number
  moved: number
  pending: number
  failedCount: number
  failed: Array<{ eventId: string; workspaceId: string; error: string | null }>
}

export interface EnterpriseInvitationProgress {
  selected: number
  completed: number
  pending: number
  failedCount: number
  failed: Array<{ eventId: string; email: string; error: string | null }>
}

export type EnterpriseFollowUpJobKind =
  | 'member_reconciliation'
  | 'personal_subscription_cancellation'
  | 'migrated_invitation_email'
  | 'workspace_added_email'

export interface EnterpriseFollowUpProgress {
  selected: number
  completed: number
  pending: number
  failedCount: number
  failed: Array<{
    eventId: string
    kind: EnterpriseFollowUpJobKind
    subjectId: string
    error: string | null
  }>
}

export class EnterpriseProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnterpriseProvisioningError'
  }
}

export interface EnterpriseIssuancePreflight {
  owner: { id: string; name: string; email: string }
  organization: { id: string; name: string; role: string } | null
  personalWorkspaces: Array<{ id: string; name: string; archived: boolean }>
  workspacePagination: { total: number; limit: number; offset: number; hasMore: boolean }
  workspaceSelection: {
    totalEligible: number
    defaultSelectedIds: string[]
    defaultSelectedWorkspaces: Array<{ id: string; name: string; archived: boolean }>
    includesAllEligible: boolean
    limit: number
  }
  billingPreview: {
    reportingPeriod: {
      anchorDate: string
      interval: 'month' | 'year'
      currentStart: string
      currentEnd: string
      source: 'reporting'
    }
    usage: {
      usedDollars: number
      limitDollars: number
      usedCredits: number
      limitCredits: number
      workflowRuns: number
    }
    invoiceAmountUsd: number
    configuredUsageLimitDollars: number
    prepaidBalanceDollars: number
    effectiveUsageLimitDollars: number
    exceedsLimit: boolean
  } | null
  canIssue: boolean
  reason: string | null
}

export interface EnterpriseIssuanceReview {
  owner: EnterpriseIssuancePreflight['owner']
  organization: EnterpriseIssuancePreflight['organization']
  billingPreview: NonNullable<EnterpriseIssuancePreflight['billingPreview']>
  workspaceSelection: {
    selected: number
  }
  invitations: {
    requested: number
    additionalSeatReservationsFromWorkspaceSweep: number
  }
  seats: EnterpriseIssuanceSeatRequirement & {
    capacity: number
    sufficient: boolean
  }
}

interface NormalizedEnterpriseIssuanceSelection {
  workspaceIds: string[]
  invitationSpecs: Array<{
    email: string
    role: 'admin' | 'member'
    permission: 'admin' | 'write' | 'read'
  }>
}

function normalizeEnterpriseIssuanceSelection(
  input: Pick<IssueEnterpriseProvisioningInput, 'workspaceIds' | 'invitations'>
): NormalizedEnterpriseIssuanceSelection {
  const workspaceIds = [...new Set(input.workspaceIds ?? [])].sort()
  if (workspaceIds.length > MAX_ENTERPRISE_WORKSPACE_SELECTION) {
    throw new EnterpriseProvisioningError('At most 1,000 workspaces can be selected')
  }
  const invitationSpecs = (input.invitations ?? []).map((invite) => ({
    ...invite,
    email: normalizeEmail(invite.email),
  }))
  if (invitationSpecs.length > MAX_INVITE_EMAILS) {
    throw new EnterpriseProvisioningError(
      `At most ${MAX_INVITE_EMAILS} people can be invited at once`
    )
  }
  const invitationEmails = new Set(invitationSpecs.map((invite) => invite.email))
  if (
    invitationEmails.size !== invitationSpecs.length ||
    invitationSpecs.some((invite) => !invite.email.includes('@'))
  ) {
    throw new EnterpriseProvisioningError('Invitation emails must be valid and unique')
  }
  if (invitationSpecs.length > 0 && workspaceIds.length === 0) {
    throw new EnterpriseProvisioningError(
      'Select at least one workspace before inviting people during Enterprise creation'
    )
  }
  if (invitationSpecs.length > 0 && workspaceIds.length > MAX_INVITE_WORKSPACES) {
    throw new EnterpriseProvisioningError(
      `Creation-time invitations can include at most ${MAX_INVITE_WORKSPACES} selected workspaces`
    )
  }
  return { workspaceIds, invitationSpecs }
}

export function computeEnterpriseIssuanceRequiredSeats({
  memberSeats,
  pendingSeats,
  invitationEmails,
  migratedInvitationEmails = [],
  existingMemberEmails,
  pendingInvitationEmails,
}: {
  memberSeats: number
  pendingSeats: number
  invitationEmails: string[]
  migratedInvitationEmails?: string[]
  existingMemberEmails: Set<string>
  pendingInvitationEmails: Set<string>
}): number {
  const newSeatInvitations = new Set(
    [...migratedInvitationEmails, ...invitationEmails].map(normalizeEmail)
  )
  for (const email of existingMemberEmails) newSeatInvitations.delete(normalizeEmail(email))
  for (const email of pendingInvitationEmails) newSeatInvitations.delete(normalizeEmail(email))
  return memberSeats + pendingSeats + newSeatInvitations.size
}

interface EnterpriseIssuanceSeatRequirement {
  memberSeats: number
  pendingSeats: number
  migratedPendingSeats: number
  newInvitationSeats: number
  requiredSeats: number
}

async function assertEnterpriseWorkspaceSelection({
  executor,
  ownerUserId,
  workspaceIds,
}: {
  executor: DbOrTx
  ownerUserId: string
  workspaceIds: string[]
}): Promise<void> {
  if (workspaceIds.length === 0) return
  const selectedWorkspaces = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        ownedAttachableWorkspacesWhere({ userId: ownerUserId, includeArchived: true }),
        inArray(workspace.id, workspaceIds)
      )
    )
    .orderBy(workspace.id)
  if (
    selectedWorkspaces.length !== workspaceIds.length ||
    selectedWorkspaces.some((row, index) => row.id !== workspaceIds[index])
  ) {
    throw new EnterpriseProvisioningError(
      'One or more selected workspaces are no longer owned personal workspaces'
    )
  }
}

export async function getEnterpriseIssuanceSeatRequirement({
  executor,
  organizationId,
  workspaceIds,
  invitationEmails,
  existingSeatEmails = [],
}: {
  executor: DbOrTx
  organizationId: string | null
  workspaceIds: string[]
  invitationEmails: string[]
  existingSeatEmails?: string[]
}): Promise<EnterpriseIssuanceSeatRequirement> {
  const migratedInvitationRows =
    workspaceIds.length === 0
      ? []
      : await executor
          .select({ email: invitation.email })
          .from(invitation)
          .innerJoin(
            invitationWorkspaceGrant,
            eq(invitationWorkspaceGrant.invitationId, invitation.id)
          )
          .where(
            and(
              eq(invitation.status, 'pending'),
              eq(invitation.membershipIntent, 'internal'),
              gt(invitation.expiresAt, new Date()),
              inArray(invitationWorkspaceGrant.workspaceId, workspaceIds),
              organizationId
                ? or(
                    isNull(invitation.organizationId),
                    ne(invitation.organizationId, organizationId)
                  )
                : undefined
            )
          )
          .groupBy(invitation.email)
          .limit(MAX_ENTERPRISE_MIGRATED_INVITATION_EMAILS + 1)
  if (migratedInvitationRows.length > MAX_ENTERPRISE_MIGRATED_INVITATION_EMAILS) {
    throw new EnterpriseProvisioningError(
      `The selected workspace sweep carries more than ${MAX_ENTERPRISE_MIGRATED_INVITATION_EMAILS.toLocaleString()} pending invitation recipients. Reduce the workspace selection or resolve older invitations before issuing Enterprise; none were omitted.`
    )
  }
  const migratedInvitationEmails = [
    ...new Set(migratedInvitationRows.map((row) => normalizeEmail(row.email))),
  ]
  const relevantEmails = [
    ...new Set([...migratedInvitationEmails, ...invitationEmails].map(normalizeEmail)),
  ]
  const [memberCount, pendingSeats, existingMemberRows, pendingInvitationRows] = await Promise.all([
    organizationId
      ? executor
          .select({ value: count() })
          .from(member)
          .where(eq(member.organizationId, organizationId))
      : Promise.resolve([{ value: 1 }]),
    organizationId ? countPendingSeatInvitations(organizationId, executor) : Promise.resolve(0),
    !organizationId || relevantEmails.length === 0
      ? Promise.resolve([])
      : executor
          .select({ email: user.email })
          .from(user)
          .innerJoin(member, eq(member.userId, user.id))
          .where(inArray(sql<string>`lower(${user.email})`, relevantEmails)),
    !organizationId || relevantEmails.length === 0
      ? Promise.resolve([])
      : executor
          .select({ email: invitation.email })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, organizationId),
              eq(invitation.status, 'pending'),
              eq(invitation.membershipIntent, 'internal'),
              gt(invitation.expiresAt, new Date()),
              inArray(invitation.email, relevantEmails)
            )
          ),
  ])
  const existingMemberEmails = new Set([
    ...existingMemberRows.map((row) => normalizeEmail(row.email)),
    ...existingSeatEmails.map(normalizeEmail),
  ])
  const pendingInvitationEmails = new Set(
    pendingInvitationRows.map((row) => normalizeEmail(row.email))
  )
  const migratedPendingSeats = migratedInvitationEmails.filter(
    (email) => !existingMemberEmails.has(email) && !pendingInvitationEmails.has(email)
  ).length
  const migratedSeatEmails = new Set(migratedInvitationEmails)
  const newInvitationSeats = invitationEmails.filter(
    (email) =>
      !migratedSeatEmails.has(email) &&
      !existingMemberEmails.has(email) &&
      !pendingInvitationEmails.has(email)
  ).length
  const memberSeats = memberCount[0]?.value ?? 0
  return {
    memberSeats,
    pendingSeats,
    migratedPendingSeats,
    newInvitationSeats,
    requiredSeats: computeEnterpriseIssuanceRequiredSeats({
      memberSeats,
      pendingSeats,
      invitationEmails,
      migratedInvitationEmails,
      existingMemberEmails,
      pendingInvitationEmails,
    }),
  }
}

export async function assertEnterpriseInvitationEligibility({
  executor,
  organizationId,
  invitationEmails,
}: {
  executor: DbOrTx
  organizationId: string | null
  invitationEmails: string[]
}): Promise<void> {
  if (invitationEmails.length === 0) return
  const existingInvitees = await executor
    .select({ email: user.email, organizationId: member.organizationId })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .where(inArray(sql<string>`lower(${user.email})`, invitationEmails))
  const crossOrganizationInvitees = existingInvitees.filter(
    (invitee) => invitee.organizationId !== null && invitee.organizationId !== organizationId
  )
  if (crossOrganizationInvitees.length > 0) {
    throw new EnterpriseProvisioningError(
      `Cannot invite existing users who belong to another organization: ${crossOrganizationInvitees.map((invitee) => invitee.email).join(', ')}`
    )
  }
}

export async function getEnterpriseIssuancePreflight({
  ownerUserId,
  search,
  limit,
  offset,
  invoiceAmountUsd,
  billingInterval,
  reportingPeriodAnchorDate,
  usageLimitDollars,
}: {
  ownerUserId: string
  search: string
  limit: number
  offset: number
  invoiceAmountUsd?: number
  billingInterval?: 'month' | 'year'
  reportingPeriodAnchorDate?: string
  usageLimitDollars?: number
}): Promise<EnterpriseIssuancePreflight> {
  const [owner] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, ownerUserId))
    .limit(1)
  if (!owner) throw new EnterpriseProvisioningError('Owner user not found')

  const [membership] = await db
    .select({
      role: member.role,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationCreditBalance: organization.creditBalance,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, ownerUserId))
    .limit(1)
  const trimmedSearch = search.trim()
  const allPersonalWorkspacesWhere = ownedAttachableWorkspacesWhere({
    userId: ownerUserId,
    includeArchived: true,
  })
  const personalWorkspaceWhere = and(
    allPersonalWorkspacesWhere,
    trimmedSearch
      ? or(ilike(workspace.name, `%${trimmedSearch}%`), eq(workspace.id, trimmedSearch))
      : undefined
  )
  const [personalWorkspaceCount, personalWorkspaces, selectionRows] = await Promise.all([
    db.select({ value: count() }).from(workspace).where(personalWorkspaceWhere),
    db
      .select({ id: workspace.id, name: workspace.name, archivedAt: workspace.archivedAt })
      .from(workspace)
      .where(personalWorkspaceWhere)
      .orderBy(workspace.name, workspace.id)
      .limit(limit)
      .offset(offset),
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        archivedAt: workspace.archivedAt,
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(workspace)
      .where(allPersonalWorkspacesWhere)
      .orderBy(workspace.id)
      .limit(MAX_ENTERPRISE_WORKSPACE_SELECTION + 1),
  ])

  let reason: string | null = null
  if (membership?.role && membership.role !== 'owner') {
    reason = 'The selected user is already a non-owner member of an organization'
  } else if (membership?.organizationId) {
    const [nonterminalSubscription] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, membership.organizationId),
          or(
            isNull(subscription.status),
            notInArray(subscription.status, [...TERMINAL_SUBSCRIPTION_STATUSES])
          )
        )
      )
      .limit(1)
    if (nonterminalSubscription) {
      reason = 'The selected owner organization already has a nonterminal subscription'
    }
  }

  const totalPersonalWorkspaces = personalWorkspaceCount[0]?.value ?? 0
  const totalEligibleWorkspaces = selectionRows[0]?.total ?? 0
  const includesAllEligible = totalEligibleWorkspaces <= MAX_ENTERPRISE_WORKSPACE_SELECTION
  const previewTermsComplete =
    invoiceAmountUsd !== undefined &&
    billingInterval !== undefined &&
    reportingPeriodAnchorDate !== undefined
  const prepaidBalanceDollars = Number(membership?.organizationCreditBalance ?? 0)
  if (
    reason === null &&
    usageLimitDollars !== undefined &&
    usageLimitDollars < prepaidBalanceDollars
  ) {
    reason = 'Enterprise usage limit cannot be below the organization prepaid balance'
  }
  let billingPreview: EnterpriseIssuancePreflight['billingPreview'] = null
  if (previewTermsComplete) {
    const reportingPeriod = resolveEnterpriseReportingPeriod(
      reportingPeriodAnchorDate,
      billingInterval
    )
    if (!reportingPeriod) {
      throw new EnterpriseProvisioningError(
        'Reporting period anchor must be a valid UTC date on or before today'
      )
    }
    const configuredUsageLimitDollars =
      usageLimitDollars === undefined
        ? invoiceAmountUsd
        : Math.max(0, usageLimitDollars - prepaidBalanceDollars)
    const effectiveUsageLimitDollars = configuredUsageLimitDollars + prepaidBalanceDollars
    const [usedDollars, workflowRuns] = membership?.organizationId
      ? await Promise.all([
          getBillingPeriodUsageCost(
            { type: 'organization', id: membership.organizationId },
            reportingPeriod
          ),
          getBillingPeriodWorkflowRunCount(
            { type: 'organization', id: membership.organizationId },
            reportingPeriod
          ),
        ])
      : [0, 0]
    billingPreview = {
      reportingPeriod: {
        anchorDate: reportingPeriod.anchorDate,
        interval: reportingPeriod.interval,
        currentStart: reportingPeriod.start.toISOString(),
        currentEnd: reportingPeriod.end.toISOString(),
        source: reportingPeriod.source,
      },
      usage: {
        usedDollars,
        limitDollars: effectiveUsageLimitDollars,
        usedCredits: dollarsToCredits(usedDollars),
        limitCredits: dollarsToCredits(effectiveUsageLimitDollars),
        workflowRuns,
      },
      invoiceAmountUsd,
      configuredUsageLimitDollars,
      prepaidBalanceDollars,
      effectiveUsageLimitDollars,
      exceedsLimit: usedDollars > effectiveUsageLimitDollars,
    }
  }

  return {
    owner,
    organization: membership
      ? {
          id: membership.organizationId,
          name: membership.organizationName,
          role: membership.role,
        }
      : null,
    personalWorkspaces: personalWorkspaces.map(({ archivedAt, ...row }) => ({
      ...row,
      archived: archivedAt !== null,
    })),
    workspacePagination: {
      total: totalPersonalWorkspaces,
      limit,
      offset,
      hasMore: offset + personalWorkspaces.length < totalPersonalWorkspaces,
    },
    workspaceSelection: {
      totalEligible: totalEligibleWorkspaces,
      defaultSelectedIds: includesAllEligible ? selectionRows.map((row) => row.id) : [],
      defaultSelectedWorkspaces: includesAllEligible
        ? selectionRows.map(({ total: _total, archivedAt, ...row }) => ({
            ...row,
            archived: archivedAt !== null,
          }))
        : [],
      includesAllEligible,
      limit: MAX_ENTERPRISE_WORKSPACE_SELECTION,
    },
    billingPreview,
    canIssue: reason === null,
    reason,
  }
}

export async function reviewEnterpriseProvisioning(
  input: Omit<
    IssueEnterpriseProvisioningInput,
    'requestedByEmail' | 'requestedByUserId' | 'requestedByName'
  >
): Promise<EnterpriseIssuanceReview> {
  const { workspaceIds, invitationSpecs } = normalizeEnterpriseIssuanceSelection(input)
  const preflight = await getEnterpriseIssuancePreflight({
    ownerUserId: input.ownerUserId,
    search: '',
    limit: 1,
    offset: 0,
    invoiceAmountUsd: input.invoiceAmountUsd,
    billingInterval: input.billingInterval ?? 'year',
    reportingPeriodAnchorDate:
      input.reportingPeriodAnchorDate ?? new Date().toISOString().slice(0, 10),
    usageLimitDollars:
      input.usageLimitCredits === undefined ? undefined : creditsToDollars(input.usageLimitCredits),
  })
  if (!preflight.canIssue) {
    throw new EnterpriseProvisioningError(
      preflight.reason ?? 'Enterprise issuance is not available for this owner'
    )
  }
  if (!preflight.organization && !input.organizationName?.trim()) {
    throw new EnterpriseProvisioningError(
      'Organization name is required when the owner has no organization'
    )
  }
  if (!preflight.billingPreview) {
    throw new EnterpriseProvisioningError('Enterprise billing terms could not be previewed')
  }

  await assertEnterpriseWorkspaceSelection({
    executor: db,
    ownerUserId: input.ownerUserId,
    workspaceIds,
  })
  const invitationEmails = invitationSpecs.map((invite) => invite.email)
  await assertEnterpriseInvitationEligibility({
    executor: db,
    organizationId: preflight.organization?.id ?? null,
    invitationEmails,
  })
  const seatRequirement = await getEnterpriseIssuanceSeatRequirement({
    executor: db,
    organizationId: preflight.organization?.id ?? null,
    workspaceIds,
    invitationEmails,
    existingSeatEmails: preflight.organization ? [] : [preflight.owner.email],
  })

  return {
    owner: preflight.owner,
    organization: preflight.organization,
    billingPreview: preflight.billingPreview,
    workspaceSelection: { selected: workspaceIds.length },
    invitations: {
      requested: invitationSpecs.length,
      additionalSeatReservationsFromWorkspaceSweep: seatRequirement.migratedPendingSeats,
    },
    seats: {
      ...seatRequirement,
      capacity: input.seats,
      sufficient: input.seats >= seatRequirement.requiredSeats,
    },
  }
}

function slugifyOrganizationName(name: string, organizationId: string): string {
  const base = slugify(name).slice(0, 80)
  return `${base || 'organization'}-${organizationId.slice(-8)}`
}

/** Builds a deterministic key from every Enterprise commercial term. */
export function buildEnterpriseProvisioningRequestKey(
  input: IssueEnterpriseProvisioningInput,
  organizationId: string,
  normalizedTerms: {
    billingInterval: 'month' | 'year'
    reportingPeriodAnchorDate: string
  }
): string {
  const usageLimitCredits = input.usageLimitCredits ?? dollarsToCredits(input.invoiceAmountUsd)
  const requestTerms: Array<string | number> = [
    'enterprise-v6',
    input.ownerUserId,
    organizationId,
    Math.round(input.invoiceAmountUsd * 100),
    normalizedTerms.billingInterval,
    normalizedTerms.reportingPeriodAnchorDate,
    [...(input.workspaceIds ?? [])].sort().join(','),
    [...(input.invitations ?? [])]
      .map((invite) => `${normalizeEmail(invite.email)},${invite.role},${invite.permission}`)
      .sort()
      .join(';'),
    usageLimitCredits,
    input.seats,
    `concurrency=${input.concurrencyLimit ?? 'default'}`,
    `workflow-timeout=${input.workflowExecutionTimeoutSeconds ?? 'default'}`,
    `collection=${input.pausePaymentCollection ? 'paused' : 'active'}`,
  ]
  return requestTerms.join(':')
}

function toEnterpriseProvisioningView(
  row: typeof outboxEvent.$inferSelect,
  payload: EnterpriseProvisionPayload,
  workspaceMoves: EnterpriseWorkspaceMoveProgress,
  invitations: EnterpriseInvitationProgress,
  followUpJobs: EnterpriseFollowUpProgress
): EnterpriseProvisioningView {
  const request = payload.request
  const updatedAt = row.processedAt ?? row.lockedAt ?? row.availableAt ?? row.createdAt
  return {
    id: row.id,
    ownerUserId: request.ownerUserId,
    organizationId: request.organizationId,
    status: deriveEnterpriseOperationStatus(row.status, payload),
    invoiceAmountUsd: request.invoiceAmountCents / 100,
    billingInterval: request.billingInterval,
    reportingPeriodAnchorDate: request.reportingPeriodAnchorDate ?? null,
    usageLimitCredits: request.usageLimitCredits + request.prepaidBalanceCreditsAtIssuance,
    seats: request.seats,
    concurrencyLimit: getBillingConcurrencyLimit('enterprise', request.concurrencyLimit),
    workflowExecutionTimeoutSeconds:
      request.workflowExecutionTimeoutSeconds ??
      resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds(
        env.EXECUTION_TIMEOUT_ASYNC_ENTERPRISE
      ),
    pausePaymentCollection: request.pausePaymentCollection,
    stripeSubscriptionId:
      payload.applicationResult?.subscriptionId ?? payload.stripeProgress.subscriptionId ?? null,
    error: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    workspaceMoves,
    invitations,
    followUpJobs,
  }
}

async function getEnterpriseWorkspaceMoveProgress(
  operations: Array<{ id: string; payload: EnterpriseProvisionPayload }>,
  options: { includeFailures?: boolean } = {}
): Promise<Map<string, EnterpriseWorkspaceMoveProgress>> {
  const operationIds = operations.map((operation) => operation.id)
  const operationIdExpression = sql<string>`${outboxEvent.payload} ->> 'provisioningOperationId'`
  const progressRows =
    operationIds.length === 0
      ? []
      : await db
          .select({
            operationId: operationIdExpression,
            moved: sql<number>`count(*) filter (where ${outboxEvent.status} = 'completed')`.mapWith(
              Number
            ),
            failed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'dead_letter')`.mapWith(
                Number
              ),
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE),
              inArray(operationIdExpression, operationIds)
            )
          )
          .groupBy(operationIdExpression)

  const failedRows =
    options.includeFailures && operationIds.length > 0
      ? await db
          .select({
            id: outboxEvent.id,
            payload: outboxEvent.payload,
            lastError: outboxEvent.lastError,
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE),
              eq(outboxEvent.status, 'dead_letter'),
              inArray(operationIdExpression, operationIds)
            )
          )
          .orderBy(outboxEvent.createdAt, outboxEvent.id)
          .limit(operationIds.length * MAX_ENTERPRISE_WORKSPACE_SELECTION)
      : []

  const result = new Map<string, EnterpriseWorkspaceMoveProgress>()
  for (const operation of operations) {
    result.set(operation.id, {
      selected: operation.payload.request.workspaceIds.length,
      moved: 0,
      pending: operation.payload.request.workspaceIds.length,
      failedCount: 0,
      failed: [],
    })
  }
  for (const row of progressRows) {
    const progress = result.get(row.operationId)
    if (!progress) continue
    progress.moved = row.moved
    progress.failedCount = row.failed
  }
  for (const row of failedRows) {
    const parsed = enterpriseWorkspaceMovePayloadSchema.safeParse(row.payload)
    if (!parsed.success) continue
    const progress = result.get(parsed.data.provisioningOperationId)
    if (!progress) continue
    progress.failed.push({
      eventId: row.id,
      workspaceId: parsed.data.workspaceId,
      error: row.lastError,
    })
  }
  for (const progress of result.values()) {
    progress.pending = Math.max(0, progress.selected - progress.moved - progress.failedCount)
  }
  return result
}

async function getEnterpriseInvitationProgress(
  operations: Array<{ id: string; payload: EnterpriseProvisionPayload }>,
  options: { includeFailures?: boolean } = {}
): Promise<Map<string, EnterpriseInvitationProgress>> {
  const operationIds = operations.map((operation) => operation.id)
  const operationIdExpression = sql<string>`${outboxEvent.payload} ->> 'provisioningOperationId'`
  const progressRows =
    operationIds.length === 0
      ? []
      : await db
          .select({
            operationId: operationIdExpression,
            completed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'completed')`.mapWith(
                Number
              ),
            failed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'dead_letter')`.mapWith(
                Number
              ),
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE),
              inArray(operationIdExpression, operationIds)
            )
          )
          .groupBy(operationIdExpression)
  const failedRows =
    options.includeFailures && operationIds.length > 0
      ? await db
          .select({
            id: outboxEvent.id,
            payload: outboxEvent.payload,
            lastError: outboxEvent.lastError,
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE),
              eq(outboxEvent.status, 'dead_letter'),
              inArray(operationIdExpression, operationIds)
            )
          )
          .orderBy(outboxEvent.createdAt, outboxEvent.id)
          .limit(operationIds.length * 100)
      : []

  const result = new Map<string, EnterpriseInvitationProgress>()
  for (const operation of operations) {
    result.set(operation.id, {
      selected: operation.payload.request.invitations.length,
      completed: 0,
      pending: operation.payload.request.invitations.length,
      failedCount: 0,
      failed: [],
    })
  }
  for (const row of progressRows) {
    const progress = result.get(row.operationId)
    if (!progress) continue
    progress.completed = row.completed
    progress.failedCount = row.failed
  }
  for (const row of failedRows) {
    const parsed = enterpriseInvitePeoplePayloadSchema.safeParse(row.payload)
    if (!parsed.success) continue
    const progress = result.get(parsed.data.provisioningOperationId)
    if (!progress) continue
    progress.failed.push({ eventId: row.id, email: parsed.data.email, error: row.lastError })
  }
  for (const progress of result.values()) {
    progress.pending = Math.max(0, progress.selected - progress.completed - progress.failedCount)
  }
  return result
}

function getEnterpriseFollowUpOperationIds(eventType: string, payload: unknown): string[] {
  if (!isRecordLike(payload)) return []
  if (eventType === ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE) {
    return typeof payload.provisioningOperationId === 'string' &&
      payload.provisioningOperationId.length > 0
      ? [payload.provisioningOperationId]
      : []
  }
  const operationIds = new Set<string>()
  if (typeof payload.sourceOperationId === 'string' && payload.sourceOperationId.length > 0) {
    operationIds.add(payload.sourceOperationId)
  }
  if (Array.isArray(payload.sourceOperationIds)) {
    for (const operationId of payload.sourceOperationIds) {
      if (typeof operationId === 'string' && operationId.length > 0) operationIds.add(operationId)
    }
  }
  return [...operationIds]
}

function getEnterpriseFollowUpFailure(
  eventType: string,
  payload: unknown
): { kind: EnterpriseFollowUpJobKind; subjectId: string } | null {
  if (!isRecordLike(payload)) return null
  if (eventType === ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE) {
    return typeof payload.organizationId === 'string'
      ? { kind: 'member_reconciliation', subjectId: payload.organizationId }
      : null
  }
  if (eventType === OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END) {
    return typeof payload.subscriptionId === 'string'
      ? { kind: 'personal_subscription_cancellation', subjectId: payload.subscriptionId }
      : null
  }
  if (eventType === MIGRATED_INVITATION_EMAIL_EVENT_TYPE) {
    return typeof payload.invitationId === 'string'
      ? { kind: 'migrated_invitation_email', subjectId: payload.invitationId }
      : null
  }
  if (eventType === DIRECT_GRANT_EMAIL_EVENT_TYPE) {
    return typeof payload.workspaceId === 'string'
      ? { kind: 'workspace_added_email', subjectId: payload.workspaceId }
      : null
  }
  return null
}

async function getEnterpriseFollowUpProgress(
  operationIds: string[],
  options: { includeFailures?: boolean } = {}
): Promise<Map<string, EnterpriseFollowUpProgress>> {
  const uniqueOperationIds = [...new Set(operationIds)]
  const operationIdExpression = sql<string>`coalesce(
    ${outboxEvent.payload} ->> 'provisioningOperationId',
    ${outboxEvent.payload} ->> 'sourceOperationId'
  )`
  const scalarProgressRows =
    uniqueOperationIds.length === 0
      ? []
      : await db
          .select({
            operationId: operationIdExpression,
            selected: count(),
            completed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'completed')`.mapWith(
                Number
              ),
            failed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'dead_letter')`.mapWith(
                Number
              ),
          })
          .from(outboxEvent)
          .where(
            and(
              inArray(outboxEvent.eventType, [...ENTERPRISE_FOLLOW_UP_EVENT_TYPES]),
              ne(outboxEvent.eventType, MIGRATED_INVITATION_EMAIL_EVENT_TYPE),
              inArray(operationIdExpression, uniqueOperationIds)
            )
          )
          .groupBy(operationIdExpression)

  const arrayOperationIdExpression = sql<string>`source_operations.operation_id`
  const sourceOperationRows = sql`lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(${outboxEvent.payload}::jsonb -> 'sourceOperationIds') = 'array'
      then ${outboxEvent.payload}::jsonb -> 'sourceOperationIds'
      else '[]'::jsonb
    end
  ) as source_operations(operation_id)`
  const arrayProgressRows =
    uniqueOperationIds.length === 0
      ? []
      : await db
          .select({
            operationId: arrayOperationIdExpression,
            selected: count(),
            completed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'completed')`.mapWith(
                Number
              ),
            failed:
              sql<number>`count(*) filter (where ${outboxEvent.status} = 'dead_letter')`.mapWith(
                Number
              ),
          })
          .from(outboxEvent)
          .innerJoin(sourceOperationRows, sql`true`)
          .where(
            and(
              eq(outboxEvent.eventType, MIGRATED_INVITATION_EMAIL_EVENT_TYPE),
              sql`coalesce(${outboxEvent.payload}::jsonb -> 'sourceOperationIds', '[]'::jsonb) ?| array[${sql.join(
                uniqueOperationIds.map((operationId) => sql`${operationId}`),
                sql`, `
              )}]::text[]`
            )
          )
          .groupBy(arrayOperationIdExpression)

  const failedRows =
    options.includeFailures && uniqueOperationIds.length === 1
      ? await db
          .select({
            id: outboxEvent.id,
            eventType: outboxEvent.eventType,
            payload: outboxEvent.payload,
            lastError: outboxEvent.lastError,
          })
          .from(outboxEvent)
          .where(
            and(
              inArray(outboxEvent.eventType, [...ENTERPRISE_FOLLOW_UP_EVENT_TYPES]),
              eq(outboxEvent.status, 'dead_letter'),
              or(
                eq(
                  sql<string>`${outboxEvent.payload} ->> 'provisioningOperationId'`,
                  uniqueOperationIds[0]
                ),
                outboxEventHasSourceOperationId(uniqueOperationIds[0])
              )
            )
          )
          .orderBy(outboxEvent.createdAt, outboxEvent.id)
          .limit(MAX_ENTERPRISE_FOLLOW_UP_FAILURE_DETAILS)
      : []

  const result = new Map<string, EnterpriseFollowUpProgress>()
  for (const operationId of uniqueOperationIds) {
    result.set(operationId, {
      selected: 0,
      completed: 0,
      pending: 0,
      failedCount: 0,
      failed: [],
    })
  }
  for (const row of [...scalarProgressRows, ...arrayProgressRows]) {
    const progress = result.get(row.operationId)
    if (!progress) continue
    progress.selected += row.selected
    progress.completed += row.completed
    progress.failedCount += row.failed
    progress.pending = Math.max(0, progress.selected - progress.completed - progress.failedCount)
  }
  for (const row of failedRows) {
    const detail = getEnterpriseFollowUpFailure(row.eventType, row.payload)
    if (!detail) continue
    for (const operationId of getEnterpriseFollowUpOperationIds(row.eventType, row.payload)) {
      const progress = result.get(operationId)
      if (!progress) continue
      progress.failed.push({
        eventId: row.id,
        ...detail,
        error: row.lastError,
      })
    }
  }
  return result
}

export async function getEnterpriseProvisioningById(
  operationId: string
): Promise<EnterpriseProvisioningView | null> {
  const [row] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
      )
    )
    .limit(1)
  if (!row) return null
  const payload = parseEnterpriseProvisionPayload(row.payload)
  if (!payload) return null
  const progress = await getEnterpriseWorkspaceMoveProgress([{ id: row.id, payload }], {
    includeFailures: true,
  })
  const invitationProgress = await getEnterpriseInvitationProgress([{ id: row.id, payload }], {
    includeFailures: true,
  })
  const followUpProgress = await getEnterpriseFollowUpProgress([row.id], {
    includeFailures: true,
  })
  return toEnterpriseProvisioningView(
    row,
    payload,
    progress.get(row.id) ?? {
      selected: payload.request.workspaceIds.length,
      moved: 0,
      pending: payload.request.workspaceIds.length,
      failedCount: 0,
      failed: [],
    },
    invitationProgress.get(row.id) ?? {
      selected: payload.request.invitations.length,
      completed: 0,
      pending: payload.request.invitations.length,
      failedCount: 0,
      failed: [],
    },
    followUpProgress.get(row.id) ?? {
      selected: 0,
      completed: 0,
      pending: 0,
      failedCount: 0,
      failed: [],
    }
  )
}

type EnterpriseSubscriptionState = Pick<
  typeof subscription.$inferSelect,
  'status' | 'stripeSubscriptionId' | 'metadata'
>

function operationHasTerminalAppliedSubscription(
  payload: EnterpriseProvisionPayload,
  subscriptions: EnterpriseSubscriptionState[]
): boolean {
  if (!payload.applicationResult) return false
  const applied = subscriptions.find(
    (row) => row.stripeSubscriptionId === payload.applicationResult?.subscriptionId
  )
  return Boolean(applied && !isNonterminalSubscriptionStatus(applied.status))
}

export type EnterpriseIssueDecision = { kind: 'create' } | { kind: 'reuse'; operationId: string }

/** Pure serialization decision used after the caller locks the organization. */
export function decideEnterpriseProvisioningIssue(
  requestKey: string,
  operationRows: Array<{ id: string; payload: unknown }>,
  subscriptionRows: EnterpriseSubscriptionState[]
): EnterpriseIssueDecision {
  for (const row of operationRows) {
    const payload = parseEnterpriseProvisionPayload(row.payload)
    if (!payload) {
      throw new EnterpriseProvisioningError(
        `Existing Enterprise issuance operation ${row.id} has an invalid payload`
      )
    }
    const terminalApplied = operationHasTerminalAppliedSubscription(payload, subscriptionRows)
    if (terminalApplied) continue
    if (payload.request.requestKey === requestKey) {
      return { kind: 'reuse', operationId: row.id }
    }
    throw new EnterpriseProvisioningError(
      payload.applicationResult
        ? 'Organization already has a different nonterminal Enterprise subscription'
        : 'Organization already has unfinished Enterprise issuance; retry that operation first'
    )
  }

  const unrelatedNonterminal = subscriptionRows.find((row) =>
    isNonterminalSubscriptionStatus(row.status)
  )
  if (unrelatedNonterminal) {
    throw new EnterpriseProvisioningError(
      'Organization already has a different nonterminal subscription'
    )
  }

  return { kind: 'create' }
}

export type EnterpriseRetryDecision =
  | { shouldRetry: false; operationId: string }
  | { shouldRetry: true; operationId: string; retryRevision: number }

export function decideEnterpriseProvisioningRetry(
  operationId: string,
  outboxStatus: string,
  payload: EnterpriseProvisionPayload
): EnterpriseRetryDecision {
  const status = deriveEnterpriseOperationStatus(outboxStatus, payload)
  if (status === 'dead_letter' || status === 'awaiting_webhook') {
    return { shouldRetry: true, operationId, retryRevision: payload.retryRevision + 1 }
  }
  return { shouldRetry: false, operationId }
}

export async function issueEnterpriseProvisioning(
  input: IssueEnterpriseProvisioningInput
): Promise<EnterpriseProvisioningView> {
  const invoiceAmountCents = Math.round(input.invoiceAmountUsd * 100)
  if (
    invoiceAmountCents <= 0 ||
    !Number.isSafeInteger(invoiceAmountCents) ||
    Math.abs(input.invoiceAmountUsd * 100 - invoiceAmountCents) > 1e-8
  ) {
    throw new EnterpriseProvisioningError(
      'Invoice amount must be at least $0.01 and use whole cents'
    )
  }
  const defaultUsageLimitCredits = dollarsToCredits(input.invoiceAmountUsd)
  const billingInterval = input.billingInterval ?? 'year'
  const reportingPeriodAnchorDate =
    input.reportingPeriodAnchorDate ?? new Date().toISOString().slice(0, 10)
  const parsedReportingAnchor = new Date(`${reportingPeriodAnchorDate}T00:00:00.000Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(reportingPeriodAnchorDate) ||
    !Number.isFinite(parsedReportingAnchor.getTime()) ||
    parsedReportingAnchor.toISOString().slice(0, 10) !== reportingPeriodAnchorDate ||
    parsedReportingAnchor.getTime() > Date.now()
  ) {
    throw new EnterpriseProvisioningError('Reporting-period start must be today or a past date')
  }
  const { workspaceIds, invitationSpecs } = normalizeEnterpriseIssuanceSelection(input)
  if (
    input.concurrencyLimit !== undefined &&
    parseBillingConcurrencyLimit(input.concurrencyLimit) !== input.concurrencyLimit
  ) {
    throw new EnterpriseProvisioningError('Concurrency limit is invalid')
  }
  if (
    input.workflowExecutionTimeoutSeconds !== undefined &&
    parseWorkflowExecutionTimeoutSeconds(input.workflowExecutionTimeoutSeconds) !==
      input.workflowExecutionTimeoutSeconds
  ) {
    throw new EnterpriseProvisioningError('Workflow execution timeout is invalid')
  }

  // Discover the lock scope without holding a transaction connection or row
  // lock. The transaction below re-reads all membership state after taking
  // the canonical organization → user-billing-identity lock order.
  const [membershipSnapshot] = await db
    .select({ role: member.role, organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, input.ownerUserId))
    .limit(1)

  const result = await db.transaction(async (tx) => {
    let organizationId: string
    let organizationToCreate: { id: string; name: string } | null = null
    if (membershipSnapshot) {
      if (membershipSnapshot.role !== 'owner') {
        throw new EnterpriseProvisioningError(
          'The selected user is a member, but not the owner, of an organization'
        )
      }
      organizationId = membershipSnapshot.organizationId
      await acquireOrganizationMutationLock(tx, organizationId)
      await acquireUserBillingIdentityLock(tx, input.ownerUserId)
      const [currentMembership] = await tx
        .select({ role: member.role, organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, input.ownerUserId))
        .limit(1)
      if (
        currentMembership?.organizationId !== organizationId ||
        currentMembership.role !== 'owner'
      ) {
        throw new EnterpriseProvisioningError('The selected user no longer owns this organization')
      }
    } else {
      await acquireUserBillingIdentityLock(tx, input.ownerUserId)
      const [currentMembership] = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, input.ownerUserId))
        .limit(1)
      if (currentMembership) {
        throw new EnterpriseProvisioningError(
          'The selected user joined an organization while issuance was starting; retry the request'
        )
      }
      if (!input.organizationName) {
        throw new EnterpriseProvisioningError(
          'Organization name is required when the owner has no organization'
        )
      }
      organizationId = `org_${generateId()}`
      organizationToCreate = { id: organizationId, name: input.organizationName }
    }

    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.ownerUserId))
      .limit(1)
    if (!owner) throw new EnterpriseProvisioningError('Owner user not found')

    if (organizationToCreate) {
      const now = new Date()
      await tx.insert(organization).values({
        id: organizationToCreate.id,
        name: organizationToCreate.name,
        slug: slugifyOrganizationName(organizationToCreate.name, organizationToCreate.id),
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(member).values({
        id: generateId(),
        userId: input.ownerUserId,
        organizationId,
        role: 'owner',
        createdAt: now,
      })
    }

    // Existing organizations were locked before the billing-identity lock.
    // Newly created rows are transaction-private, so no second advisory lock
    // is necessary and avoiding one preserves the canonical lock order.
    const [organizationRow] = await tx
      .select({ creditBalance: organization.creditBalance })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update')
      .limit(1)
    if (!organizationRow) throw new EnterpriseProvisioningError('Organization not found')
    const prepaidCredits = dollarsToCredits(Number(organizationRow.creditBalance ?? 0))
    if (input.usageLimitCredits !== undefined && input.usageLimitCredits < prepaidCredits) {
      throw new EnterpriseProvisioningError(
        'Enterprise usage limit cannot be below the organization prepaid balance'
      )
    }
    const configuredUsageLimitCredits =
      input.usageLimitCredits === undefined
        ? defaultUsageLimitCredits
        : input.usageLimitCredits - prepaidCredits
    const normalizedInput = { ...input, usageLimitCredits: configuredUsageLimitCredits }
    const requestKey = buildEnterpriseProvisioningRequestKey(normalizedInput, organizationId, {
      billingInterval,
      reportingPeriodAnchorDate,
    })
    const [lockedOwner] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, input.ownerUserId)))
      .limit(1)
    if (lockedOwner?.role !== 'owner') {
      throw new EnterpriseProvisioningError('The selected user no longer owns this organization')
    }

    await assertEnterpriseInvitationEligibility({
      executor: tx,
      organizationId,
      invitationEmails: invitationSpecs.map((invite) => invite.email),
    })

    await assertEnterpriseWorkspaceSelection({
      executor: tx,
      ownerUserId: input.ownerUserId,
      workspaceIds,
    })
    const seatRequirement = await getEnterpriseIssuanceSeatRequirement({
      executor: tx,
      organizationId,
      workspaceIds,
      invitationEmails: invitationSpecs.map((invite) => invite.email),
    })
    if (input.seats < seatRequirement.requiredSeats) {
      throw new EnterpriseProvisioningError(
        `Enterprise seat capacity cannot be below the ${seatRequirement.requiredSeats} seats occupied or reserved by current members, invitations, and the selected workspace sweep`
      )
    }

    const operationRows = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE),
          sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
        )
      )
      .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
      .for('update')
      .limit(1)
    const latestOperation = operationRows[0]
    const latestPayload = latestOperation
      ? parseEnterpriseProvisionPayload(latestOperation.payload)
      : null
    if (latestOperation && !latestPayload) {
      throw new EnterpriseProvisioningError(
        `Existing Enterprise issuance operation ${latestOperation.id} has an invalid payload`
      )
    }

    const appliedSubscriptionId = latestPayload?.applicationResult?.subscriptionId ?? null
    const subscriptionRows: EnterpriseSubscriptionState[] = []
    if (appliedSubscriptionId) {
      const [appliedSubscription] = await tx
        .select({
          status: subscription.status,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          metadata: subscription.metadata,
        })
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, organizationId),
            eq(subscription.stripeSubscriptionId, appliedSubscriptionId)
          )
        )
        .limit(1)
      if (appliedSubscription) subscriptionRows.push(appliedSubscription)
    }

    const [unrelatedNonterminalSubscription] = await tx
      .select({
        status: subscription.status,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        metadata: subscription.metadata,
      })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          or(
            isNull(subscription.status),
            notInArray(subscription.status, [...TERMINAL_SUBSCRIPTION_STATUSES])
          ),
          appliedSubscriptionId
            ? or(
                isNull(subscription.stripeSubscriptionId),
                ne(subscription.stripeSubscriptionId, appliedSubscriptionId)
              )
            : undefined
        )
      )
      .limit(1)
    if (unrelatedNonterminalSubscription) {
      subscriptionRows.push(unrelatedNonterminalSubscription)
    }

    const decision = decideEnterpriseProvisioningIssue(requestKey, operationRows, subscriptionRows)
    if (decision.kind === 'reuse') {
      return { operationId: decision.operationId, created: false as const }
    }

    const request: EnterpriseProvisionRequest = {
      requestKey,
      ownerUserId: input.ownerUserId,
      organizationId,
      requestedByEmail: input.requestedByEmail,
      requestedByUserId: input.requestedByUserId,
      requestedByName: input.requestedByName ?? 'Admin Panel',
      invoiceAmountCents,
      billingInterval,
      reportingPeriodAnchorDate,
      workspaceIds,
      invitations: invitationSpecs,
      usageLimitCredits: configuredUsageLimitCredits,
      prepaidBalanceCreditsAtIssuance: prepaidCredits,
      seats: input.seats,
      ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: input.concurrencyLimit } : {}),
      ...(input.workflowExecutionTimeoutSeconds !== undefined
        ? { workflowExecutionTimeoutSeconds: input.workflowExecutionTimeoutSeconds }
        : {}),
      pausePaymentCollection: input.pausePaymentCollection ?? false,
      logoutOwnerOnApply: true,
    }
    const payload: EnterpriseProvisionPayload = {
      version: 2,
      request,
      retryRevision: 0,
      stripeProgress: {},
    }
    const operationId = await enqueueOutboxEvent(tx, ENTERPRISE_PROVISION_EVENT_TYPE, payload)
    return { operationId, created: true as const }
  })

  const view = await getEnterpriseProvisioningById(result.operationId)
  if (!view) throw new Error('Enterprise issuance operation was not persisted')
  if (result.created) {
    recordAudit({
      actorId: input.requestedByUserId,
      actorName: input.requestedByName ?? 'Admin Panel',
      actorEmail: input.requestedByEmail === 'admin-api' ? null : input.requestedByEmail,
      action: AuditAction.ENTERPRISE_SUBSCRIPTION_PROVISIONED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: view.id,
      description: `Admin requested Enterprise issuance for organization ${view.organizationId}`,
      metadata: {
        organizationId: view.organizationId,
        invoiceAmountCents: Math.round(view.invoiceAmountUsd * 100),
        billingInterval: view.billingInterval,
        reportingPeriodAnchorDate: view.reportingPeriodAnchorDate,
        workspaceCount: workspaceIds.length,
        usageLimitCredits: view.usageLimitCredits,
        seats: view.seats,
        concurrencyLimit: view.concurrencyLimit,
        workflowExecutionTimeoutSeconds: view.workflowExecutionTimeoutSeconds,
        pausePaymentCollection: view.pausePaymentCollection,
        status: view.status,
      },
    })
  }
  return view
}

export async function retryEnterpriseProvisioning(
  operationId: string,
  actor: { id: string | null; name: string; email: string | null }
): Promise<EnterpriseProvisioningView> {
  const [snapshot] = await db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
      )
    )
    .limit(1)
  const snapshotPayload = snapshot && parseEnterpriseProvisionPayload(snapshot.payload)
  if (!snapshotPayload) throw new EnterpriseProvisioningError('Enterprise operation not found')

  const result = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, snapshotPayload.request.organizationId)
    const [row] = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.id, operationId),
          eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
        )
      )
      .for('update')
      .limit(1)
    const payload = row && parseEnterpriseProvisionPayload(row.payload)
    if (!row || !payload) throw new EnterpriseProvisioningError('Enterprise operation not found')

    const localSubscriptions = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, payload.request.organizationId))
    const conflicting = localSubscriptions.find(
      (candidate) =>
        subscriptionOperationId(candidate.metadata) !== operationId &&
        isNonterminalSubscriptionStatus(candidate.status)
    )
    if (conflicting) {
      throw new EnterpriseProvisioningError(
        'Organization now has a different nonterminal subscription; issuance cannot be retried'
      )
    }

    const decision = decideEnterpriseProvisioningRetry(operationId, row.status, payload)
    if (!decision.shouldRetry) return false

    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
        payload: sql`(${outboxEvent.payload}::jsonb || ${JSON.stringify({ retryRevision: decision.retryRevision })}::jsonb)::json`,
      })
      .where(eq(outboxEvent.id, decision.operationId))
    return true
  })

  const view = await getEnterpriseProvisioningById(operationId)
  if (!view) throw new EnterpriseProvisioningError('Enterprise operation not found')
  if (result) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ENTERPRISE_SUBSCRIPTION_PROVISIONED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: operationId,
      description: 'Admin retried Enterprise issuance',
      metadata: { organizationId: view.organizationId, status: view.status },
    })
  }
  return view
}

export async function retryEnterpriseWorkspaceMove(
  operationId: string,
  moveEventId: string,
  actor: { id: string | null; name: string; email: string | null }
): Promise<EnterpriseProvisioningView> {
  const [snapshot] = await db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, moveEventId),
        eq(outboxEvent.eventType, ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE)
      )
    )
    .limit(1)
  const parsedSnapshot = enterpriseWorkspaceMovePayloadSchema.safeParse(snapshot?.payload)
  if (!parsedSnapshot.success || parsedSnapshot.data.provisioningOperationId !== operationId) {
    throw new EnterpriseProvisioningError('Enterprise workspace move not found')
  }

  const retried = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, parsedSnapshot.data.destinationOrganizationId)
    const [row] = await tx
      .select({ status: outboxEvent.status, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, moveEventId))
      .for('update')
      .limit(1)
    const payload = enterpriseWorkspaceMovePayloadSchema.safeParse(row?.payload)
    if (!row || !payload.success || payload.data.provisioningOperationId !== operationId) {
      throw new EnterpriseProvisioningError('Enterprise workspace move not found')
    }
    if (row.status !== 'dead_letter') return false
    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
      })
      .where(eq(outboxEvent.id, moveEventId))
    return true
  })

  const view = await getEnterpriseProvisioningById(operationId)
  if (!view) throw new EnterpriseProvisioningError('Enterprise operation not found')
  if (retried) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: parsedSnapshot.data.workspaceId,
      description: 'Admin retried Enterprise issuance workspace move',
      metadata: {
        organizationId: parsedSnapshot.data.destinationOrganizationId,
        provisioningOperationId: operationId,
        moveEventId,
      },
    })
  }
  return view
}

export async function retryEnterpriseInvitation(
  operationId: string,
  invitationEventId: string,
  actor: { id: string | null; name: string; email: string | null }
): Promise<EnterpriseProvisioningView> {
  const [snapshot] = await db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, invitationEventId),
        eq(outboxEvent.eventType, ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE)
      )
    )
    .limit(1)
  const parsedSnapshot = enterpriseInvitePeoplePayloadSchema.safeParse(snapshot?.payload)
  if (!parsedSnapshot.success || parsedSnapshot.data.provisioningOperationId !== operationId) {
    throw new EnterpriseProvisioningError('Enterprise invitation not found')
  }

  const retried = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, parsedSnapshot.data.organizationId)
    const [row] = await tx
      .select({ status: outboxEvent.status, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, invitationEventId))
      .for('update')
      .limit(1)
    const payload = enterpriseInvitePeoplePayloadSchema.safeParse(row?.payload)
    if (!row || !payload.success || payload.data.provisioningOperationId !== operationId) {
      throw new EnterpriseProvisioningError('Enterprise invitation not found')
    }
    if (row.status !== 'dead_letter') return false
    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
      })
      .where(eq(outboxEvent.id, invitationEventId))
    return true
  })

  const view = await getEnterpriseProvisioningById(operationId)
  if (!view) throw new EnterpriseProvisioningError('Enterprise operation not found')
  if (retried) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: parsedSnapshot.data.organizationId,
      description: 'Admin retried Enterprise creation invitation',
      metadata: {
        organizationId: parsedSnapshot.data.organizationId,
        provisioningOperationId: operationId,
        email: parsedSnapshot.data.email,
      },
    })
  }
  return view
}

export async function retryEnterpriseFollowUpJob(
  operationId: string,
  jobEventId: string,
  actor: { id: string | null; name: string; email: string | null }
): Promise<EnterpriseProvisioningView> {
  const [operationRow] = await db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
      )
    )
    .limit(1)
  const operationPayload = parseEnterpriseProvisionPayload(operationRow?.payload)
  if (!operationPayload) throw new EnterpriseProvisioningError('Enterprise operation not found')

  const [snapshot] = await db
    .select({ eventType: outboxEvent.eventType, payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(eq(outboxEvent.id, jobEventId))
    .limit(1)
  const snapshotDetail = snapshot
    ? getEnterpriseFollowUpFailure(snapshot.eventType, snapshot.payload)
    : null
  if (
    !snapshot ||
    !snapshotDetail ||
    !getEnterpriseFollowUpOperationIds(snapshot.eventType, snapshot.payload).includes(
      operationId
    ) ||
    (snapshotDetail.kind === 'member_reconciliation' &&
      snapshotDetail.subjectId !== operationPayload.request.organizationId)
  ) {
    throw new EnterpriseProvisioningError('Enterprise follow-up job not found')
  }

  const retried = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, operationPayload.request.organizationId)
    const [row] = await tx
      .select({
        status: outboxEvent.status,
        eventType: outboxEvent.eventType,
        payload: outboxEvent.payload,
      })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, jobEventId))
      .for('update')
      .limit(1)
    const detail = row ? getEnterpriseFollowUpFailure(row.eventType, row.payload) : null
    if (
      !row ||
      !detail ||
      !getEnterpriseFollowUpOperationIds(row.eventType, row.payload).includes(operationId) ||
      (detail.kind === 'member_reconciliation' &&
        detail.subjectId !== operationPayload.request.organizationId)
    ) {
      throw new EnterpriseProvisioningError('Enterprise follow-up job not found')
    }
    if (row.status !== 'dead_letter') return false
    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
      })
      .where(eq(outboxEvent.id, jobEventId))
    return true
  })

  const view = await getEnterpriseProvisioningById(operationId)
  if (!view) throw new EnterpriseProvisioningError('Enterprise operation not found')
  if (retried) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: operationPayload.request.organizationId,
      description: 'Admin retried an Enterprise issuance follow-up job',
      metadata: {
        organizationId: operationPayload.request.organizationId,
        provisioningOperationId: operationId,
        jobEventId,
        jobKind: snapshotDetail.kind,
        subjectId: snapshotDetail.subjectId,
      },
    })
  }
  return view
}

async function resolveCanonicalCustomer(params: {
  stripe: Stripe
  operationId: string
  payload: EnterpriseProvisionPayload
  owner: { id: string; name: string; email: string; stripeCustomerId: string | null }
}): Promise<string> {
  if (params.owner.stripeCustomerId) return params.owner.stripeCustomerId

  let candidateId = params.payload.stripeProgress.customerId ?? null
  if (!candidateId) {
    candidateId =
      (await findOperationCustomer(params.stripe, params.owner.email, params.operationId))?.id ??
      null
  }
  if (!candidateId) {
    const customer = await params.stripe.customers.create(
      {
        email: params.owner.email,
        name: params.owner.name,
        metadata: {
          enterpriseOperationId: params.operationId,
          ownerUserId: params.owner.id,
        },
      },
      { idempotencyKey: `enterprise:${params.operationId}:customer` }
    )
    candidateId = customer.id
  }

  const attached = await db
    .update(user)
    .set({ stripeCustomerId: candidateId, updatedAt: new Date() })
    .where(and(eq(user.id, params.owner.id), isNull(user.stripeCustomerId)))
    .returning({ stripeCustomerId: user.stripeCustomerId })
  if (attached[0]?.stripeCustomerId) return attached[0].stripeCustomerId

  const [current] = await db
    .select({ stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.id, params.owner.id))
    .limit(1)
  if (!current?.stripeCustomerId) throw new Error('Unable to establish canonical Stripe customer')
  return current.stripeCustomerId
}

/**
 * The subscription create call also creates its first invoice. Freeze that
 * invoice before pausing collection so it cannot auto-finalize in the small
 * interval between the two Stripe operations.
 */
async function keepInitialEnterpriseInvoiceAsDraft(params: {
  stripe: Stripe
  subscription: Stripe.Subscription
  operationId: string
}): Promise<void> {
  const latestInvoice = params.subscription.latest_invoice
  if (!latestInvoice) {
    throw new Error('Paused Enterprise subscription did not expose its initial invoice')
  }
  const invoiceId = typeof latestInvoice === 'string' ? latestInvoice : latestInvoice.id
  if (!invoiceId) {
    throw new Error('Paused Enterprise subscription initial invoice has no ID')
  }

  const invoice =
    typeof latestInvoice === 'string'
      ? await params.stripe.invoices.retrieve(invoiceId)
      : latestInvoice
  if (invoice.status !== 'draft') {
    throw new Error(
      `Paused Enterprise initial invoice ${invoiceId} is already ${invoice.status ?? 'in an unknown state'}`
    )
  }
  if (invoice.auto_advance === false) return

  await params.stripe.invoices.update(
    invoiceId,
    { auto_advance: false },
    { idempotencyKey: `enterprise:${params.operationId}:initial-invoice-draft` }
  )
}

type EnterpriseMetadataDeliveryState = NonNullable<EnterpriseMetadataSyncPayload['deliveryState']>

function stripePauseState(
  pause: Stripe.Subscription.PauseCollection | null
): EnterpriseMetadataDeliveryState['priorPause'] {
  return pause
    ? {
        behavior: pause.behavior,
        resumesAt: pause.resumes_at ?? null,
      }
    : null
}

function stripePauseMatchesDeliveryState(
  pause: Stripe.Subscription.PauseCollection | null,
  expected: EnterpriseMetadataDeliveryState['priorPause']
): boolean {
  const actual = stripePauseState(pause)
  return actual === null
    ? expected === null
    : expected !== null &&
        actual.behavior === expected.behavior &&
        actual.resumesAt === expected.resumesAt
}

async function verifyEnterpriseMetadataDelivery(params: {
  subscription: Stripe.Subscription
  deliveryState: EnterpriseMetadataDeliveryState
  context: OutboxEventContext
}): Promise<void> {
  const providerAcceptedAt = params.deliveryState.providerAcceptedAt ?? new Date().toISOString()
  const acceptedState = { ...params.deliveryState, providerAcceptedAt }
  if (!params.deliveryState.providerAcceptedAt) {
    await params.context.checkpointPayload({ deliveryState: acceptedState })
  }

  if (
    !stripePauseMatchesDeliveryState(params.subscription.pause_collection, acceptedState.priorPause)
  ) {
    throw new Error('Stripe did not preserve Enterprise payment-collection pause settings')
  }

  if (!acceptedState.verifiedAt) {
    await params.context.checkpointPayload({
      deliveryState: { ...acceptedState, verifiedAt: new Date().toISOString() },
    })
  }
}

export const provisionEnterpriseInStripe: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseProvisionPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise issuance outbox payload')
  let payload = parsed.data
  if (payload.applicationResult) return
  const request = payload.request

  const [record] = await db
    .select({
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
      ownerStripeCustomerId: user.stripeCustomerId,
      organizationName: organization.name,
      ownerRole: member.role,
    })
    .from(user)
    .innerJoin(organization, eq(organization.id, request.organizationId))
    .leftJoin(
      member,
      and(eq(member.organizationId, request.organizationId), eq(member.userId, request.ownerUserId))
    )
    .where(eq(user.id, request.ownerUserId))
    .limit(1)
  if (!record) throw new Error('Enterprise issuance owner or organization no longer exists')
  if (record.ownerRole !== 'owner')
    throw new Error('Issuance owner no longer owns the organization')

  const [memberCount] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, request.organizationId))
  if (request.seats < (memberCount?.value ?? 0)) {
    throw new Error('Enterprise seat capacity is below current internal membership')
  }

  const stripe = requireStripeClient()
  const customerId = await resolveCanonicalCustomer({
    stripe,
    operationId: context.eventId,
    payload,
    owner: {
      id: record.ownerId,
      name: record.ownerName,
      email: record.ownerEmail,
      stripeCustomerId: record.ownerStripeCustomerId,
    },
  })
  if (payload.stripeProgress.customerId !== customerId) {
    const stripeProgress = { ...payload.stripeProgress, customerId }
    await context.checkpointPayload({ stripeProgress })
    payload = { ...payload, stripeProgress }
  }

  const locallyRecoveredSubscriptionId = await inspectLocalOrganizationSubscriptions({
    organizationId: request.organizationId,
    operationId: context.eventId,
    expectedStripeSubscriptionId: payload.stripeProgress.subscriptionId ?? null,
  })
  const expectedSubscriptionId =
    payload.stripeProgress.subscriptionId ?? locallyRecoveredSubscriptionId

  const metadata = {
    plan: 'enterprise',
    referenceId: request.organizationId,
    organizationId: request.organizationId,
    enterpriseOperationId: context.eventId,
    invoiceAmountCents: request.invoiceAmountCents.toString(),
    ...(request.reportingPeriodAnchorDate
      ? {
          reportingPeriodAnchorDate: request.reportingPeriodAnchorDate,
          reportingPeriodInterval: request.billingInterval,
        }
      : {}),
    usageLimitCredits: request.usageLimitCredits.toString(),
    seats: request.seats.toString(),
    ...(request.concurrencyLimit !== undefined
      ? { concurrencyLimit: request.concurrencyLimit.toString() }
      : {}),
    ...(request.workflowExecutionTimeoutSeconds !== undefined
      ? { workflowExecutionTimeoutSeconds: request.workflowExecutionTimeoutSeconds.toString() }
      : {}),
  }

  // Recover the subscription before creating supporting catalog objects. This
  // handles a prior successful create whose final outbox checkpoint was lost.
  let stripeSubscription = await inspectStripeOrganizationSubscriptions({
    stripe,
    customerId,
    organizationId: request.organizationId,
    operationId: context.eventId,
    expectedStripeSubscriptionId: expectedSubscriptionId,
  })

  let createdSubscription = false
  if (!stripeSubscription) {
    let productId = payload.stripeProgress.productId ?? null
    let priceId = payload.stripeProgress.priceId ?? null
    if (productId) {
      const checkpointedProduct = await stripe.products.retrieve(productId, {
        expand: ['default_price'],
      })
      if (checkpointedProduct.metadata?.enterpriseOperationId !== context.eventId) {
        throw new Error('Checkpointed Stripe product belongs to a different Enterprise operation')
      }
      priceId ??=
        typeof checkpointedProduct.default_price === 'string'
          ? checkpointedProduct.default_price
          : (checkpointedProduct.default_price?.id ?? null)
    } else {
      const recoveredProduct = await retrieveOperationProduct(stripe, context.eventId)
      productId = recoveredProduct?.id ?? null
      priceId =
        typeof recoveredProduct?.default_price === 'string'
          ? recoveredProduct.default_price
          : (recoveredProduct?.default_price?.id ?? priceId)
    }
    if (productId && !priceId) {
      priceId = (await findOperationPrice(stripe, productId, context.eventId))?.id ?? null
    }
    if (!productId) {
      const product = await stripe.products.create(
        {
          id: `prod_sim_enterprise_${context.eventId.replace(/[^a-zA-Z0-9]/g, '')}`,
          name: `${record.organizationName} Enterprise`,
          metadata: { enterpriseOperationId: context.eventId },
          default_price_data: {
            currency: 'usd',
            unit_amount: request.invoiceAmountCents,
            recurring: { interval: request.billingInterval },
            metadata: { enterpriseOperationId: context.eventId },
          },
          expand: ['default_price'],
        },
        { idempotencyKey: `enterprise:${context.eventId}:product` }
      )
      productId = product.id
      priceId =
        typeof product.default_price === 'string'
          ? product.default_price
          : (product.default_price?.id ?? null)
    }
    if (!priceId) {
      priceId = (await findOperationPrice(stripe, productId, context.eventId))?.id ?? null
    }
    if (!priceId) throw new Error('Unable to recover Enterprise recurring price')
    const price = await stripe.prices.retrieve(priceId)
    assertEnterprisePrice(price, request, context.eventId, productId)

    const stripeProgress = {
      ...payload.stripeProgress,
      customerId,
      productId,
      priceId,
    }
    await context.checkpointPayload({ stripeProgress })
    payload = { ...payload, stripeProgress }

    // A different process may have created a subscription while catalog
    // recovery was running. Re-scan immediately before the create call.
    stripeSubscription = await inspectStripeOrganizationSubscriptions({
      stripe,
      customerId,
      organizationId: request.organizationId,
      operationId: context.eventId,
      expectedStripeSubscriptionId: expectedSubscriptionId,
    })
  }

  if (!stripeSubscription) {
    const priceId = payload.stripeProgress.priceId
    if (!priceId) throw new Error('Enterprise recurring price was not checkpointed')

    // Canonical Sim-side entitlement conversions are fenced by the unresolved
    // outbox intent. Re-read local state and capacity at the final external
    // side-effect boundary as defense in depth against a checkout/webhook that
    // was already in flight before the intent was committed.
    const finalLocalSubscriptionId = await inspectLocalOrganizationSubscriptions({
      organizationId: request.organizationId,
      operationId: context.eventId,
      expectedStripeSubscriptionId: expectedSubscriptionId,
    })
    if (finalLocalSubscriptionId) {
      stripeSubscription = await inspectStripeOrganizationSubscriptions({
        stripe,
        customerId,
        organizationId: request.organizationId,
        operationId: context.eventId,
        expectedStripeSubscriptionId: finalLocalSubscriptionId,
      })
    }

    const finalSeatRequirement = await getEnterpriseIssuanceSeatRequirement({
      executor: db,
      organizationId: request.organizationId,
      workspaceIds: request.workspaceIds,
      invitationEmails: request.invitations.map((invite) => invite.email),
    })
    if (request.seats < finalSeatRequirement.requiredSeats) {
      throw new Error(
        'Enterprise seat capacity is below current occupied or reserved seats, including the selected workspace sweep'
      )
    }
  }

  if (!stripeSubscription) {
    const priceId = payload.stripeProgress.priceId
    if (!priceId) throw new Error('Enterprise recurring price was not checkpointed')
    stripeSubscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        metadata,
      },
      { idempotencyKey: `enterprise:${context.eventId}:subscription` }
    )
    createdSubscription = true
  }

  if (request.pausePaymentCollection) {
    await keepInitialEnterpriseInvoiceAsDraft({
      stripe,
      subscription: stripeSubscription,
      operationId: context.eventId,
    })
  }

  if (!createdSubscription || request.pausePaymentCollection) {
    stripeSubscription = await stripe.subscriptions.update(
      stripeSubscription.id,
      {
        metadata: {
          ...metadata,
          enterpriseRetryRevision: payload.retryRevision.toString(),
        },
        pause_collection: request.pausePaymentCollection ? { behavior: 'keep_as_draft' } : '',
      },
      {
        idempotencyKey: createdSubscription
          ? `enterprise:${context.eventId}:pause-collection`
          : `enterprise:${context.eventId}:retry:${payload.retryRevision}`,
      }
    )
  }

  if (payload.stripeProgress.subscriptionId !== stripeSubscription.id) {
    const stripeProgress = {
      ...payload.stripeProgress,
      customerId,
      subscriptionId: stripeSubscription.id,
    }
    await context.checkpointPayload({ stripeProgress })
  }
}

export const syncEnterpriseMetadataInStripe: OutboxHandler<unknown> = async (
  rawPayload,
  context
) => {
  const parsed = enterpriseMetadataSyncPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise metadata-sync outbox payload')
  const payload = parsed.data

  const [subscriptionRow] = await db
    .select({
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      referenceId: subscription.referenceId,
      metadata: subscription.metadata,
    })
    .from(subscription)
    .where(eq(subscription.id, payload.subscriptionId))
    .limit(1)
  if (!subscriptionRow?.stripeSubscriptionId) return
  const stripeSubscriptionId = subscriptionRow.stripeSubscriptionId
  if (metadataRecord(subscriptionRow.metadata).simConfigOperationId === context.eventId) return

  return withEnterpriseReconciliationLease(stripeSubscriptionId, async () => {
    const [currentSubscription] = await db
      .select({ metadata: subscription.metadata })
      .from(subscription)
      .where(eq(subscription.id, payload.subscriptionId))
      .limit(1)
    if (metadataRecord(currentSubscription?.metadata).simConfigOperationId === context.eventId) {
      return
    }

    const [latest] = await db
      .select({ id: outboxEvent.id, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ENTERPRISE_METADATA_SYNC_EVENT_TYPE),
          sql`${outboxEvent.payload} ->> 'subscriptionId' = ${payload.subscriptionId}`
        )
      )
      .orderBy(
        desc(sql`coalesce((${outboxEvent.payload} ->> 'revision')::bigint, 0)`),
        desc(outboxEvent.createdAt),
        desc(outboxEvent.id)
      )
      .limit(1)
    if (!latest || latest.id !== context.eventId) return

    const latestPayload = enterpriseMetadataSyncPayloadSchema.safeParse(latest.payload)
    if (!latestPayload.success) throw new Error('Latest Enterprise metadata intent is invalid')
    if (
      latestPayload.data.terms &&
      latestPayload.data.commercialTermsRetiredAt &&
      !enterpriseMetadataIntentProviderAccepted(latestPayload.data)
    ) {
      return
    }
    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(latestPayload.data.metadata)) {
      if (value === null) metadata[key] = ''
      else if (value !== undefined) metadata[key] = String(value)
    }
    metadata.simConfigRevision = String(latestPayload.data.revision)
    metadata.simConfigOperationId = context.eventId
    metadata.simConfigDeliveryRevision = String(latestPayload.data.deliveryRevision)
    metadata.simConfigDeliveryAttempt = String(context.attempts)

    const stripe = requireStripeClient()
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const deliveryAlreadyWritten = enterpriseMetadataIntentMatchesStripeSubscription(
      latestPayload.data,
      context.eventId,
      stripeSubscription
    )
    if (deliveryAlreadyWritten) {
      const deliveryState = latestPayload.data.deliveryState
      if (!deliveryState) {
        throw new Error('Enterprise configuration delivery state was not checkpointed')
      }
      await verifyEnterpriseMetadataDelivery({
        subscription: stripeSubscription,
        deliveryState,
        context,
      })
      return waitForEnterpriseWebhookAcknowledgement(latestPayload.data.acknowledgement, context)
    }
    if (latestPayload.data.terms) {
      if (enterpriseMetadataIntentProviderAccepted(latestPayload.data)) {
        throw new Error(
          'Legacy Enterprise commercial terms were accepted by Stripe but no longer match; manual reconciliation is required'
        )
      }
      await context.checkpointPayload({ commercialTermsRetiredAt: new Date().toISOString() })
      return
    }

    const desiredSeats = Number(latestPayload.data.metadata.seats)
    const currentSeatRequirement = await getEnterpriseIssuanceSeatRequirement({
      executor: db,
      organizationId: subscriptionRow.referenceId,
      workspaceIds: [],
      invitationEmails: [],
    })
    if (
      !Number.isSafeInteger(desiredSeats) ||
      desiredSeats < currentSeatRequirement.requiredSeats
    ) {
      throw new Error('Enterprise seat intent is below current occupied or reserved seats')
    }

    const deliveryState: EnterpriseMetadataDeliveryState = {
      priorPause: stripePauseState(stripeSubscription.pause_collection),
      billingIntervalChanged: false,
    }
    await context.checkpointPayload({ deliveryState })

    const updatedSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      {
        metadata,
      },
      {
        idempotencyKey: `enterprise-config:${payload.subscriptionId}:${context.eventId}:delivery:${latestPayload.data.deliveryRevision}:attempt:${context.attempts}`,
      }
    )
    await verifyEnterpriseMetadataDelivery({
      subscription: updatedSubscription,
      deliveryState,
      context,
    })

    // Stripe's verified webhook is the only path that applies metadata to the
    // canonical subscription row. Normal delivery latency has a durable grace
    // window that does not consume handler attempts. A genuinely missing
    // acknowledgement begins consuming the finite outbox budget after it.
    return waitForEnterpriseWebhookAcknowledgement(latestPayload.data.acknowledgement, context)
  })
}

export const moveEnterpriseWorkspace: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseWorkspaceMovePayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise workspace-move outbox payload')
  const payload = parsed.data

  const [earlierActive] = await db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE),
        inArray(outboxEvent.status, ['pending', 'processing']),
        sql`${outboxEvent.payload} ->> 'provisioningOperationId' = ${payload.provisioningOperationId}`,
        sql`coalesce((${outboxEvent.payload} ->> 'sequence')::integer, 0) < ${payload.sequence}`,
        sql`${outboxEvent.id} <> ${context.eventId}`
      )
    )
    .limit(1)
  if (earlierActive) {
    // This is dependency ordering, not a failed delivery. The earlier row has
    // its own finite attempt budget and will become completed or dead-letter,
    // so waiting here must not consume this workspace's retry budget.
    return deferOutboxHandler('Waiting for an earlier Enterprise workspace move', undefined, false)
  }

  await moveWorkspaceToOrganization({
    workspaceId: payload.workspaceId,
    destinationOrganizationId: payload.destinationOrganizationId,
    expectedOwnerId: payload.expectedOwnerId,
    adminEmail: payload.adminEmail,
    auditActor: {
      id: payload.adminUserId,
      name: payload.adminName,
      email: payload.adminEmail,
    },
    auditOperationId: context.eventId,
    operationCorrelationId: payload.provisioningOperationId,
  })
}

type EnterpriseInvitationApplicationState =
  | { kind: 'applied'; resultId: string }
  | {
      kind: 'pending'
      invitationId: string
      token: string
      grants: Array<{ workspaceId: string; permission: 'admin' | 'write' | 'read' }>
    }
  | { kind: 'conflict'; error: string }
  | { kind: 'missing' }

async function resolveEnterpriseInvitationApplicationState(
  payload: EnterpriseInvitePeoplePayload,
  workspaceIds: string[]
): Promise<EnterpriseInvitationApplicationState> {
  const normalizedEmail = normalizeEmail(payload.email)
  const [existingUser] = await db
    .select({ id: user.id, organizationId: member.organizationId, role: member.role })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .where(eq(user.normalizedEmail, normalizedEmail))
    .limit(1)
  const roleSatisfied =
    existingUser?.organizationId === payload.organizationId &&
    (payload.role === 'member' || isOrgAdminRole(existingUser.role))
  if (existingUser && roleSatisfied) {
    const accessRows = await db
      .select({ workspaceId: permissions.entityId, permission: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, existingUser.id),
          inArray(permissions.entityId, workspaceIds)
        )
      )
    const accessByWorkspace = new Map(
      accessRows.map((row) => [row.workspaceId, row.permission] as const)
    )
    if (
      workspaceIds.every((workspaceId) =>
        permissionSatisfies(accessByWorkspace.get(workspaceId), payload.permission)
      )
    ) {
      return { kind: 'applied', resultId: existingUser.id }
    }
  }

  const pendingRows = await db
    .select({
      id: invitation.id,
      token: invitation.token,
      role: invitation.role,
      membershipIntent: invitation.membershipIntent,
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(
        eq(invitation.organizationId, payload.organizationId),
        eq(invitation.email, normalizedEmail),
        eq(invitation.kind, 'workspace'),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date())
      )
    )
  const pending = pendingRows[0]
  if (!pending || pendingRows.some((row) => row.id !== pending.id)) {
    return { kind: 'missing' }
  }
  if (
    pending.membershipIntent !== 'internal' ||
    (payload.role === 'admin' && !isOrgAdminRole(pending.role))
  ) {
    return {
      kind: 'conflict',
      error: `${normalizedEmail} has a pending invitation with a different organization role. Cancel it before retrying Enterprise provisioning.`,
    }
  }

  const pendingGrantByWorkspace = new Map(
    pendingRows.map((row) => [row.workspaceId, row.permission] as const)
  )
  const weakerGrant = workspaceIds.find((workspaceId) => {
    const permission = pendingGrantByWorkspace.get(workspaceId)
    return permission !== undefined && !permissionSatisfies(permission, payload.permission)
  })
  if (weakerGrant) {
    return {
      kind: 'conflict',
      error: `${normalizedEmail} already has a weaker pending grant for workspace ${weakerGrant}. Cancel that invitation before retrying Enterprise provisioning.`,
    }
  }
  if (!workspaceIds.every((workspaceId) => pendingGrantByWorkspace.has(workspaceId))) {
    return { kind: 'missing' }
  }

  return {
    kind: 'pending',
    invitationId: pending.id,
    token: pending.token,
    grants: pendingRows.map((row) => ({
      workspaceId: row.workspaceId,
      permission: row.permission,
    })),
  }
}

export const inviteEnterprisePeople: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseInvitePeoplePayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise invitation outbox payload')
  const payload = parsed.data
  if (payload.delivery) return

  const [parentRow] = await db
    .select({ eventType: outboxEvent.eventType, payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(eq(outboxEvent.id, payload.provisioningOperationId))
    .limit(1)
  let workspaceIds: string[]
  let auditActor: { id: string | null; name: string; email: string | null }
  if (payload.source === 'enterprise') {
    const provisioning =
      parentRow?.eventType === ENTERPRISE_PROVISION_EVENT_TYPE
        ? parseEnterpriseProvisionPayload(parentRow.payload)
        : null
    if (
      !provisioning?.applicationResult ||
      provisioning.request.organizationId !== payload.organizationId ||
      provisioning.request.ownerUserId !== payload.ownerUserId
    ) {
      throw new Error('Enterprise provisioning context is unavailable for invitation delivery')
    }
    workspaceIds = provisioning.request.workspaceIds
    auditActor = {
      id: provisioning.request.requestedByUserId,
      name: provisioning.request.requestedByName,
      email: provisioning.request.requestedByEmail,
    }
  } else {
    const operation =
      parentRow?.eventType === ADMIN_INVITATION_OPERATION_EVENT_TYPE
        ? parseAdminInvitationOperationPayload(parentRow.payload)
        : null
    if (
      !operation ||
      operation.request.organizationId !== payload.organizationId ||
      operation.request.ownerUserId !== payload.ownerUserId
    ) {
      throw new Error('Admin invitation-operation context is unavailable')
    }
    workspaceIds = operation.request.workspaceIds
    auditActor = operation.request.actor
  }
  if (workspaceIds.length === 0) {
    throw new Error('Invitation operation has no selected workspace grants')
  }

  const [earlierActive] = await db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE),
        inArray(outboxEvent.status, ['pending', 'processing']),
        sql`${outboxEvent.payload} ->> 'provisioningOperationId' = ${payload.provisioningOperationId}`,
        sql`coalesce((${outboxEvent.payload} ->> 'sequence')::integer, 0) < ${payload.sequence}`,
        sql`${outboxEvent.id} <> ${context.eventId}`
      )
    )
    .limit(1)
  if (earlierActive) {
    return deferOutboxHandler('Waiting for an earlier invitation recipient', undefined, false)
  }

  if (payload.source === 'enterprise') {
    const moveRows = await db
      .select({ status: outboxEvent.status })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE),
          sql`${outboxEvent.payload} ->> 'provisioningOperationId' = ${payload.provisioningOperationId}`
        )
      )
    if (
      moveRows.length !== workspaceIds.length ||
      moveRows.some((row) => row.status !== 'completed')
    ) {
      return deferOutboxHandler(
        'Waiting for the Enterprise workspace sweep before sending invitations',
        undefined,
        false
      )
    }
  }
  const applicationState = await resolveEnterpriseInvitationApplicationState(payload, workspaceIds)
  if (applicationState.kind === 'conflict') throw new Error(applicationState.error)
  if (applicationState.kind === 'applied' && !payload.attemptedAt) {
    await context.checkpointPayload({
      delivery: {
        completedAt: new Date().toISOString(),
        resultId: applicationState.resultId,
        outcome: 'unchanged',
      },
    })
    return
  }

  const normalizedEmail = normalizeEmail(payload.email)
  const [existingInvitee] = await db
    .select({ organizationId: member.organizationId })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .where(eq(user.normalizedEmail, normalizedEmail))
    .limit(1)
  if (
    existingInvitee?.organizationId &&
    existingInvitee.organizationId !== payload.organizationId
  ) {
    throw new Error(
      `${normalizedEmail} already belongs to another organization and cannot be invited as an internal member`
    )
  }

  const [owner] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, payload.ownerUserId))
    .limit(1)
  if (!owner) throw new Error('Organization owner no longer exists')

  const contextForInvitation = await prepareWorkspaceInvitationContext({
    workspaceIds,
    inviterId: owner.id,
    inviterName: owner.name || owner.email,
    inviterEmail: owner.email,
    auditActor,
  })
  if (applicationState.kind === 'applied') {
    for (const target of contextForInvitation.targets) {
      await recordAuditOnce(`${context.eventId}:workspace-invitation:${target.workspaceId}`, {
        workspaceId: target.workspaceId,
        actorId: auditActor.id,
        actorName: auditActor.name,
        actorEmail: auditActor.email,
        action: AuditAction.MEMBER_INVITED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: target.workspaceId,
        resourceName: normalizedEmail,
        description: `Confirmed durable Admin-requested access for ${normalizedEmail}`,
        metadata: {
          targetEmail: normalizedEmail,
          targetRole: payload.permission,
          membershipIntent: 'internal',
          organizationRole: payload.role,
          workspaceName: target.workspaceDetails.name,
          provisioningOperationId: payload.provisioningOperationId,
          recoveredAfterResponseLoss: true,
        },
      })
    }
    await context.checkpointPayload({
      delivery: {
        completedAt: new Date().toISOString(),
        resultId: applicationState.resultId,
        outcome: 'added',
      },
    })
    return
  }
  if (!payload.attemptedAt) {
    await context.checkpointPayload({ attemptedAt: new Date().toISOString() })
  }
  let resultId: string
  let outcome: 'sent' | 'added' | 'unchanged'
  if (applicationState.kind === 'pending') {
    const emailResult = await sendInvitationEmail({
      invitationId: applicationState.invitationId,
      token: applicationState.token,
      kind: 'workspace',
      email: normalizedEmail,
      inviterName: owner.name || owner.email,
      organizationId: payload.organizationId,
      organizationRole: payload.role,
      grants: applicationState.grants,
    })
    if (!emailResult.success) {
      throw new Error(emailResult.error || 'Failed to resend invitation email')
    }
    for (const target of contextForInvitation.targets) {
      await recordAuditOnce(`${context.eventId}:workspace-invitation:${target.workspaceId}`, {
        workspaceId: target.workspaceId,
        actorId: auditActor.id,
        actorName: auditActor.name,
        actorEmail: auditActor.email,
        action: AuditAction.MEMBER_INVITED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: target.workspaceId,
        resourceName: normalizedEmail,
        description: `Resent Admin-requested invitation to ${normalizedEmail} as ${payload.permission}`,
        metadata: {
          targetEmail: normalizedEmail,
          targetRole: payload.permission,
          membershipIntent: 'internal',
          organizationRole: payload.role,
          workspaceName: target.workspaceDetails.name,
          invitationId: applicationState.invitationId,
          provisioningOperationId: payload.provisioningOperationId,
        },
      })
    }
    resultId = applicationState.invitationId
    outcome = 'sent'
  } else {
    const invitationResult = await createWorkspaceInvitation({
      context: contextForInvitation,
      email: normalizedEmail,
      permission: payload.permission,
      membership: payload.role,
      rejectCrossOrganization: true,
      existingAccessPolicy: 'ensure-at-least',
      sourceOperationId: payload.provisioningOperationId,
      auditOperationId: context.eventId,
    })
    resultId = invitationResult.id
    outcome = invitationResult.instantAdd
      ? invitationResult.outcome === 'unchanged'
        ? 'unchanged'
        : 'added'
      : 'sent'
  }
  const finalState = await resolveEnterpriseInvitationApplicationState(payload, workspaceIds)
  if (finalState.kind === 'conflict') throw new Error(finalState.error)
  if (finalState.kind !== 'applied' && finalState.kind !== 'pending') {
    throw new Error(
      `Invitation for ${normalizedEmail} did not apply the requested organization role and workspace permissions`
    )
  }
  await context.checkpointPayload({
    delivery: { completedAt: new Date().toISOString(), resultId, outcome },
  })
}

export const reconcileEnterpriseMembers: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseMemberReconciliationPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise member-reconciliation payload')
  const payload = parsed.data

  const nextCursor = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, payload.organizationId)
    const rows = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, payload.organizationId),
          payload.afterUserId ? gt(member.userId, payload.afterUserId) : undefined
        )
      )
      .orderBy(member.userId)
      .limit(ENTERPRISE_MEMBER_RECONCILIATION_BATCH_SIZE + 1)

    const batch = rows.slice(0, ENTERPRISE_MEMBER_RECONCILIATION_BATCH_SIZE)
    for (const row of batch) {
      await reapplyPaidOrgJoinBillingForExistingMemberTx(tx, row.userId, payload.organizationId, {
        sourceOperationId: payload.provisioningOperationId ?? undefined,
      })
    }

    return rows.length > ENTERPRISE_MEMBER_RECONCILIATION_BATCH_SIZE
      ? (batch.at(-1)?.userId ?? null)
      : null
  })

  if (!nextCursor) return
  await context.checkpointPayload({ afterUserId: nextCursor })
  return continueOutboxHandler('Continuing bounded Enterprise member reconciliation')
}

export const enterpriseIssuanceOutboxHandlers = {
  [ENTERPRISE_PROVISION_EVENT_TYPE]: provisionEnterpriseInStripe,
  [ENTERPRISE_METADATA_SYNC_EVENT_TYPE]: syncEnterpriseMetadataInStripe,
  [ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE]: moveEnterpriseWorkspace,
  [ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE]: inviteEnterprisePeople,
  [ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE]: reconcileEnterpriseMembers,
} as const

export async function getLatestEnterpriseProvisionings(
  organizationIds: string[],
  options: { includeWorkspaceMoveFailures?: boolean } = {}
) {
  const result = new Map<string, EnterpriseProvisioningView>()
  if (organizationIds.length === 0) return result
  const uniqueOrganizationIds = [...new Set(organizationIds)]
  if (uniqueOrganizationIds.length > MAX_ENTERPRISE_PROVISIONING_LOOKUP_ORGANIZATIONS) {
    throw new Error(
      `Enterprise provisioning lookup is limited to ${MAX_ENTERPRISE_PROVISIONING_LOOKUP_ORGANIZATIONS} organizations`
    )
  }
  if (options.includeWorkspaceMoveFailures && uniqueOrganizationIds.length !== 1) {
    throw new Error('Workspace-move failure details require exactly one organization')
  }
  const organizationIdExpression = sql<string>`${outboxEvent.payload} #>> '{request,organizationId}'`
  const rows = await db
    .selectDistinctOn([organizationIdExpression])
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE),
        inArray(organizationIdExpression, uniqueOrganizationIds)
      )
    )
    .orderBy(organizationIdExpression, desc(outboxEvent.createdAt), desc(outboxEvent.id))
  const latestRows: Array<{
    row: typeof outboxEvent.$inferSelect
    payload: EnterpriseProvisionPayload
  }> = []
  for (const row of rows) {
    const payload = parseEnterpriseProvisionPayload(row.payload)
    if (!payload) throw new Error(`Enterprise issuance outbox payload ${row.id} is invalid`)
    latestRows.push({ row, payload })
  }
  const progress = await getEnterpriseWorkspaceMoveProgress(
    latestRows.map(({ row, payload }) => ({ id: row.id, payload })),
    { includeFailures: options.includeWorkspaceMoveFailures }
  )
  const invitationProgress = await getEnterpriseInvitationProgress(
    latestRows.map(({ row, payload }) => ({ id: row.id, payload })),
    { includeFailures: options.includeWorkspaceMoveFailures }
  )
  const followUpProgress = await getEnterpriseFollowUpProgress(
    latestRows.map(({ row }) => row.id),
    { includeFailures: options.includeWorkspaceMoveFailures }
  )
  for (const { row, payload } of latestRows) {
    result.set(
      payload.request.organizationId,
      toEnterpriseProvisioningView(
        row,
        payload,
        progress.get(row.id) ?? {
          selected: payload.request.workspaceIds.length,
          moved: 0,
          pending: payload.request.workspaceIds.length,
          failedCount: 0,
          failed: [],
        },
        invitationProgress.get(row.id) ?? {
          selected: payload.request.invitations.length,
          completed: 0,
          pending: payload.request.invitations.length,
          failedCount: 0,
          failed: [],
        },
        followUpProgress.get(row.id) ?? {
          selected: 0,
          completed: 0,
          pending: 0,
          failedCount: 0,
          failed: [],
        }
      )
    )
  }
  return result
}

export { ENTERPRISE_METADATA_SYNC_EVENT_TYPE, ENTERPRISE_PROVISION_EVENT_TYPE }
