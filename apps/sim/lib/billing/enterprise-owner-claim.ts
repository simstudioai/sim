import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { foldedEmail, member, outboxEvent, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { normalizeEmail, slugify } from '@sim/utils/string'
import { and, count, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getEmailSubject, renderEnterpriseOwnerInvitationEmail } from '@/components/emails'
import { parseBillingConcurrencyLimit } from '@/lib/billing/concurrency-defaults'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  assertEnterpriseInvitationEligibility,
  EnterpriseProvisioningError,
  getEnterpriseIssuanceSeatRequirement,
  getEnterpriseProvisioningById,
  issueEnterpriseProvisioning,
  MAX_ENTERPRISE_WORKSPACE_SELECTION,
  retryEnterpriseProvisioning,
} from '@/lib/billing/enterprise-provisioning'
import { parseWorkflowExecutionTimeoutSeconds } from '@/lib/billing/execution-timeout-defaults'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { createOrganizationWithOwnerTx } from '@/lib/billing/organizations/create-organization'
import {
  enqueueOutboxEvent,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  patchOutboxEventPayload,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'
import { computeInvitationExpiry, INVITATION_EXPIRY_DAYS } from '@/lib/invitations/expiry'
import { MAX_INVITE_EMAILS, MAX_INVITE_WORKSPACES } from '@/lib/invitations/limits'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import {
  createDefaultPersonalWorkspaceInTransaction,
  emitWorkspaceCreatedPlatformEvent,
} from '@/lib/workspaces/create'
import { ownedAttachableWorkspacesWhere } from '@/lib/workspaces/organization-workspaces'

export const ENTERPRISE_OWNER_CLAIM_EVENT_TYPE = 'enterprise.invite-owner'
export const ENTERPRISE_OWNER_ACTIVATION_EVENT_TYPE = 'enterprise.activate-owner-claim'
export const ENTERPRISE_OWNER_CLAIM_EXPIRY_DAYS = INVITATION_EXPIRY_DAYS

const logger = createLogger('EnterpriseOwnerClaim')
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export class EnterpriseOwnerClaimEmailMismatchError extends Error {}
export class EnterpriseOwnerClaimWorkspaceLimitError extends Error {}

const enterpriseOwnerClaimInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
  permission: z.enum(['admin', 'write', 'read']),
})

const enterpriseOwnerClaimRequestSchema = z.object({
  requestKey: z.string().min(1),
  ownerEmail: z.string().email(),
  organizationName: z.string().min(1).max(120),
  requestedByEmail: z.string().min(1),
  requestedByUserId: z.string().nullable(),
  requestedByName: z.string().min(1),
  invoiceAmountCents: z.number().int().positive(),
  billingInterval: z.enum(['month', 'year']),
  invitations: z.array(enterpriseOwnerClaimInvitationSchema).max(MAX_INVITE_EMAILS),
  usageLimitCredits: nonnegativeInteger,
  seats: z.number().int().positive(),
  concurrencyLimit: z.number().int().positive().optional(),
  workflowExecutionTimeoutSeconds: z.number().int().positive().optional(),
  pausePaymentCollection: z.boolean(),
})

const enterpriseOwnerClaimAcceptanceSchema = z.object({
  acceptedAt: z.string().datetime(),
  ownerUserId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceIds: z.array(z.string().min(1)).max(MAX_ENTERPRISE_WORKSPACE_SELECTION),
  reportingPeriodAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activationEventId: z.string().min(1),
  createdDefaultWorkspaceId: z.string().min(1).nullable(),
})

export const enterpriseOwnerClaimPayloadSchema = z.object({
  version: z.literal(1),
  request: enterpriseOwnerClaimRequestSchema,
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  delivery: z.object({ sentAt: z.string().datetime() }).optional(),
  acceptance: enterpriseOwnerClaimAcceptanceSchema.optional(),
  provisioningOperationId: z.string().min(1).optional(),
})

const enterpriseOwnerActivationPayloadSchema = z.object({
  claimId: z.string().min(1),
  provisioningOperationId: z.string().min(1).optional(),
})

type EnterpriseOwnerClaimPayload = z.infer<typeof enterpriseOwnerClaimPayloadSchema>
type EnterpriseOwnerActivationPayload = z.infer<typeof enterpriseOwnerActivationPayloadSchema>

export interface EnterpriseOwnerClaimInput {
  ownerEmail: string
  organizationName: string
  invoiceAmountUsd: number
  billingInterval?: 'month' | 'year'
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

export interface EnterpriseOwnerClaimReview {
  ownerEmail: string
  organizationName: string
  activationTiming: 'after_owner_acceptance'
  invoiceAmountUsd: number
  billingInterval: 'month' | 'year'
  usageLimitCredits: number
  invitations: { requested: number }
  workspaces: { resolvedAtAcceptance: true }
  seats: {
    ownerSeats: 1
    newInvitationSeats: number
    requiredSeats: number
    capacity: number
    sufficient: boolean
  }
}

export interface EnterpriseOwnerClaimView {
  id: string
  ownerEmail: string
  organizationName: string
  organizationId: string | null
  provisioningOperationId: string | null
  stage: 'owner_email' | 'owner_acceptance' | 'activation' | 'stripe_provisioning' | 'complete'
  status:
    | 'sending'
    | 'awaiting_owner'
    | 'activating'
    | 'provisioning'
    | 'applied'
    | 'failed'
    | 'expired'
    | 'revoked'
  error: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface EnterpriseOwnerClaimDetails extends EnterpriseOwnerClaimView {
  invoiceAmountUsd: number
  billingInterval: 'month' | 'year'
  seats: number
  invitations: number
  workspacePreview: {
    workspacesToMove: Array<{ id: string; name: string; archived: boolean }>
    createsDefaultWorkspace: boolean
  } | null
  acceptanceReview: {
    canAccept: boolean
    reason: string | null
    requiredSeats: number | null
  } | null
}

export type AcceptEnterpriseOwnerClaimFailure =
  | 'not-found'
  | 'invalid-token'
  | 'expired'
  | 'revoked'
  | 'email-mismatch'
  | 'already-in-organization'
  | 'disclosure-outdated'
  | 'workspace-limit'
  | 'workspace-invitation-limit'
  | 'insufficient-seats'
  | 'server-error'

export type AcceptEnterpriseOwnerClaimResult =
  | { success: true; claim: EnterpriseOwnerClaimView; redirectPath: string }
  | { success: false; kind: AcceptEnterpriseOwnerClaimFailure; message?: string }

function parseClaimPayload(value: unknown): EnterpriseOwnerClaimPayload | null {
  const parsed = enterpriseOwnerClaimPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function normalizeClaimInput(input: EnterpriseOwnerClaimInput) {
  const ownerEmail = normalizeEmail(input.ownerEmail)
  const organizationName = input.organizationName.trim()
  const invoiceAmountCents = Math.round(input.invoiceAmountUsd * 100)
  if (!ownerEmail.includes('@')) throw new EnterpriseProvisioningError('Owner email is invalid')
  if (!organizationName) {
    throw new EnterpriseProvisioningError('Organization name is required for a new owner')
  }
  if (
    invoiceAmountCents <= 0 ||
    !Number.isSafeInteger(invoiceAmountCents) ||
    Math.abs(input.invoiceAmountUsd * 100 - invoiceAmountCents) > 1e-8
  ) {
    throw new EnterpriseProvisioningError(
      'Invoice amount must be at least $0.01 and use whole cents'
    )
  }
  const invitations = (input.invitations ?? []).map((invitation) => ({
    ...invitation,
    email: normalizeEmail(invitation.email),
  }))
  const invitationEmails = new Set(invitations.map((invitation) => invitation.email))
  if (
    invitations.length > MAX_INVITE_EMAILS ||
    invitationEmails.size !== invitations.length ||
    invitations.some((invitation) => !invitation.email.includes('@'))
  ) {
    throw new EnterpriseProvisioningError(
      `Invite at most ${MAX_INVITE_EMAILS} people using valid, unique emails`
    )
  }
  if (invitationEmails.has(ownerEmail)) {
    throw new EnterpriseProvisioningError(
      'The future owner must not also appear in the teammate invitation list'
    )
  }
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
  const usageLimitCredits = input.usageLimitCredits ?? dollarsToCredits(input.invoiceAmountUsd)
  if (!Number.isSafeInteger(usageLimitCredits) || usageLimitCredits < 0) {
    throw new EnterpriseProvisioningError('Usage limit is invalid')
  }
  const requiredSeats = 1 + invitations.length
  if (input.seats < requiredSeats) {
    throw new EnterpriseProvisioningError(
      `Enterprise seat capacity must be at least ${requiredSeats} for the owner and requested invitations`
    )
  }
  const billingInterval = input.billingInterval ?? 'year'
  return {
    ownerEmail,
    organizationName,
    invoiceAmountCents,
    billingInterval,
    invitations,
    usageLimitCredits,
    requiredSeats,
  }
}

function buildClaimRequestKey(
  input: EnterpriseOwnerClaimInput,
  normalized: ReturnType<typeof normalizeClaimInput>
): string {
  return [
    'enterprise-owner-claim-v1',
    normalized.ownerEmail,
    normalized.organizationName,
    normalized.invoiceAmountCents,
    normalized.billingInterval,
    normalized.invitations
      .map((invitation) => `${invitation.email},${invitation.role},${invitation.permission}`)
      .sort()
      .join(';'),
    normalized.usageLimitCredits,
    input.seats,
    `concurrency=${input.concurrencyLimit ?? 'default'}`,
    `workflow-timeout=${input.workflowExecutionTimeoutSeconds ?? 'default'}`,
    `collection=${input.pausePaymentCollection ? 'paused' : 'active'}`,
  ].join(':')
}

async function assertOwnerEmailHasNoAccount(ownerEmail: string): Promise<void> {
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(foldedEmail(user.email), ownerEmail))
    .limit(1)
  if (existingUser) {
    throw new EnterpriseProvisioningError(
      'A Sim account now exists for this email. Select that account so its organization and workspaces can be reviewed before issuance.'
    )
  }
}

export async function reviewEnterpriseOwnerClaim(
  input: EnterpriseOwnerClaimInput
): Promise<EnterpriseOwnerClaimReview> {
  const normalized = normalizeClaimInput(input)
  await assertOwnerEmailHasNoAccount(normalized.ownerEmail)
  await assertEnterpriseInvitationEligibility({
    executor: db,
    organizationId: null,
    invitationEmails: normalized.invitations.map((invitation) => invitation.email),
  })
  return {
    ownerEmail: normalized.ownerEmail,
    organizationName: normalized.organizationName,
    activationTiming: 'after_owner_acceptance',
    invoiceAmountUsd: normalized.invoiceAmountCents / 100,
    billingInterval: normalized.billingInterval,
    usageLimitCredits: normalized.usageLimitCredits,
    invitations: { requested: normalized.invitations.length },
    workspaces: { resolvedAtAcceptance: true },
    seats: {
      ownerSeats: 1,
      newInvitationSeats: normalized.invitations.length,
      requiredSeats: normalized.requiredSeats,
      capacity: input.seats,
      sufficient: input.seats >= normalized.requiredSeats,
    },
  }
}

async function getClaimRow(claimId: string) {
  const [row] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(eq(outboxEvent.id, claimId), eq(outboxEvent.eventType, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE))
    )
    .limit(1)
  return row ?? null
}

async function toClaimView(
  row: typeof outboxEvent.$inferSelect,
  payload: EnterpriseOwnerClaimPayload
): Promise<EnterpriseOwnerClaimView> {
  let status: EnterpriseOwnerClaimView['status']
  let stage: EnterpriseOwnerClaimView['stage']
  let error = row.lastError
  let provisioningOperationId = payload.provisioningOperationId ?? null
  let updatedAt = row.processedAt ?? row.lockedAt ?? row.availableAt ?? row.createdAt

  if (!payload.acceptance) {
    stage = row.status === 'completed' ? 'owner_acceptance' : 'owner_email'
    status = payload.revokedAt
      ? 'revoked'
      : new Date(payload.expiresAt).getTime() <= Date.now()
        ? 'expired'
        : row.status === 'dead_letter'
          ? 'failed'
          : row.status === 'completed'
            ? 'awaiting_owner'
            : 'sending'
    if (payload.revokedAt) {
      error = null
      updatedAt = new Date(payload.revokedAt)
    }
  } else {
    const [activationRow] = await db
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, payload.acceptance.activationEventId))
      .limit(1)
    const activationPayload = activationRow
      ? enterpriseOwnerActivationPayloadSchema.safeParse(activationRow.payload)
      : null
    provisioningOperationId =
      provisioningOperationId ||
      (activationPayload?.success ? (activationPayload.data.provisioningOperationId ?? null) : null)
    if (activationRow) {
      updatedAt =
        activationRow.processedAt ??
        activationRow.lockedAt ??
        activationRow.availableAt ??
        activationRow.createdAt
      if (activationRow.status === 'dead_letter') error = activationRow.lastError
    }
    if (!activationRow || activationRow.status === 'dead_letter') {
      stage = 'activation'
      status = 'failed'
    } else if (!provisioningOperationId) {
      stage = 'activation'
      status = 'activating'
    } else {
      const provisioning = await getEnterpriseProvisioningById(provisioningOperationId)
      if (!provisioning) {
        stage = 'activation'
        status = 'activating'
      } else if (provisioning.status === 'applied') {
        stage = 'complete'
        status = 'applied'
        error = null
        updatedAt = new Date(provisioning.updatedAt)
      } else if (provisioning.status === 'dead_letter') {
        stage = 'stripe_provisioning'
        status = 'failed'
        error = provisioning.error
        updatedAt = new Date(provisioning.updatedAt)
      } else {
        stage = 'stripe_provisioning'
        status = 'provisioning'
        error = provisioning.error
        updatedAt = new Date(provisioning.updatedAt)
      }
    }
  }

  return {
    id: row.id,
    ownerEmail: payload.request.ownerEmail,
    organizationName: payload.request.organizationName,
    organizationId: payload.acceptance?.organizationId ?? null,
    provisioningOperationId,
    stage,
    status,
    error,
    expiresAt: payload.expiresAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

export async function getEnterpriseOwnerClaimView(
  claimId: string
): Promise<EnterpriseOwnerClaimView | null> {
  const row = await getClaimRow(claimId)
  if (!row) return null
  const payload = parseClaimPayload(row.payload)
  if (!payload) throw new Error('Enterprise owner claim payload is invalid')
  return toClaimView(row, payload)
}

export async function getOpenEnterpriseOwnerClaimsPage(params: {
  limit: number
  offset: number
}): Promise<{ data: EnterpriseOwnerClaimView[]; total: number }> {
  const openClaim = and(
    eq(outboxEvent.eventType, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE),
    sql`${outboxEvent.payload} -> 'revokedAt' is null`,
    sql`${outboxEvent.payload} -> 'provisioningOperationId' is null`,
    or(
      sql`${outboxEvent.payload} -> 'acceptance' is not null`,
      sql`(${outboxEvent.payload} ->> 'expiresAt')::timestamptz > now()`
    )
  )
  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(outboxEvent).where(openClaim),
    db
      .select()
      .from(outboxEvent)
      .where(openClaim)
      .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
      .limit(params.limit)
      .offset(params.offset),
  ])
  const data = await Promise.all(
    rows.map(async (row) => {
      const payload = parseClaimPayload(row.payload)
      if (!payload) throw new Error(`Enterprise owner claim ${row.id} has an invalid payload`)
      return toClaimView(row, payload)
    })
  )
  return { data, total: countRows[0]?.value ?? 0 }
}

export async function createEnterpriseOwnerClaim(
  input: EnterpriseOwnerClaimInput
): Promise<EnterpriseOwnerClaimView> {
  const normalized = normalizeClaimInput(input)
  await assertOwnerEmailHasNoAccount(normalized.ownerEmail)
  await assertEnterpriseInvitationEligibility({
    executor: db,
    organizationId: null,
    invitationEmails: normalized.invitations.map((invitation) => invitation.email),
  })
  const requestKey = buildClaimRequestKey(input, normalized)
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`enterprise-owner-claim:${normalized.ownerEmail}`}, 0))`
    )
    const [accountCreatedDuringReview] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(foldedEmail(user.email), normalized.ownerEmail))
      .limit(1)
    if (accountCreatedDuringReview) {
      throw new EnterpriseProvisioningError(
        'A Sim account now exists for this email. Select that account so its organization and workspaces can be reviewed before issuance.'
      )
    }

    const rows = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE),
          sql`${outboxEvent.payload} #>> '{request,ownerEmail}' = ${normalized.ownerEmail}`
        )
      )
      .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
      .for('update')
      .limit(10)
    for (const row of rows) {
      const payload = parseClaimPayload(row.payload)
      if (!payload || payload.request.ownerEmail !== normalized.ownerEmail) continue
      const inactive =
        Boolean(payload.revokedAt) || new Date(payload.expiresAt).getTime() <= Date.now()
      if (payload.request.requestKey === requestKey && !inactive) {
        return { id: row.id, created: false }
      }
      if (!payload.acceptance && !inactive) {
        throw new EnterpriseProvisioningError(
          'This email already has a pending Enterprise owner invitation. Reuse or revoke it before changing the terms.'
        )
      }
    }

    const id = generateId()
    const token = generateId()
    const expiresAt = computeInvitationExpiry()
    const payload: EnterpriseOwnerClaimPayload = {
      version: 1,
      request: {
        requestKey,
        ownerEmail: normalized.ownerEmail,
        organizationName: normalized.organizationName,
        requestedByEmail: input.requestedByEmail,
        requestedByUserId: input.requestedByUserId,
        requestedByName: input.requestedByName ?? 'Admin Panel',
        invoiceAmountCents: normalized.invoiceAmountCents,
        billingInterval: normalized.billingInterval,
        invitations: normalized.invitations,
        usageLimitCredits: normalized.usageLimitCredits,
        seats: input.seats,
        ...(input.concurrencyLimit !== undefined
          ? { concurrencyLimit: input.concurrencyLimit }
          : {}),
        ...(input.workflowExecutionTimeoutSeconds !== undefined
          ? { workflowExecutionTimeoutSeconds: input.workflowExecutionTimeoutSeconds }
          : {}),
        pausePaymentCollection: input.pausePaymentCollection ?? false,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    }
    await enqueueOutboxEvent(tx, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE, payload, { id })
    return { id, created: true }
  })

  await recordAuditOnce(`${result.id}:requested`, {
    actorId: input.requestedByUserId,
    actorName: input.requestedByName ?? 'Admin Panel',
    actorEmail: input.requestedByEmail === 'admin-api' ? null : input.requestedByEmail,
    action: AuditAction.ENTERPRISE_SUBSCRIPTION_PROVISIONED,
    resourceType: AuditResourceType.SUBSCRIPTION,
    resourceId: result.id,
    description: `Admin invited ${normalized.ownerEmail} to activate an Enterprise organization`,
    metadata: {
      ownerEmail: normalized.ownerEmail,
      organizationName: normalized.organizationName,
      activationTiming: 'after_owner_acceptance',
      invoiceAmountCents: normalized.invoiceAmountCents,
      billingInterval: normalized.billingInterval,
      invitationCount: normalized.invitations.length,
      seats: input.seats,
    },
  })
  if (result.created) {
    await processOutboxEventById(result.id, enterpriseOwnerClaimOutboxHandlers)
  }
  const view = await getEnterpriseOwnerClaimView(result.id)
  if (!view) throw new Error('Enterprise owner claim was not persisted')
  return view
}

export async function retryEnterpriseOwnerClaim(
  claimId: string
): Promise<EnterpriseOwnerClaimView> {
  let eventIdToProcess: string | null = null
  let provisioningOperationId: string | null = null
  let retryActor: { id: string | null; name: string; email: string | null } | null = null
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.id, claimId),
          eq(outboxEvent.eventType, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE)
        )
      )
      .for('update')
      .limit(1)
    const payload = parseClaimPayload(row?.payload)
    if (!row || !payload) throw new EnterpriseProvisioningError('Owner invitation not found')
    retryActor = {
      id: payload.request.requestedByUserId,
      name: payload.request.requestedByName,
      email:
        payload.request.requestedByEmail === 'admin-api' ? null : payload.request.requestedByEmail,
    }
    if (!payload.acceptance) {
      if (payload.revokedAt) {
        throw new EnterpriseProvisioningError('Owner invitation has been revoked; create a new one')
      }
      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        throw new EnterpriseProvisioningError('Owner invitation has expired; create a new one')
      }
      if (row.status !== 'dead_letter') return
      await resetOutboxEventForRetry(tx, claimId)
      eventIdToProcess = claimId
      return
    }

    const [activationRow] = await tx
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, payload.acceptance.activationEventId))
      .for('update')
      .limit(1)
    if (!activationRow) throw new Error('Enterprise owner activation event is missing')
    const activationPayload = enterpriseOwnerActivationPayloadSchema.safeParse(
      activationRow.payload
    )
    if (!activationPayload.success)
      throw new Error('Enterprise owner activation payload is invalid')
    provisioningOperationId =
      payload.provisioningOperationId ?? activationPayload.data.provisioningOperationId ?? null
    if (!payload.provisioningOperationId && provisioningOperationId) {
      await patchOutboxEventPayload(tx, claimId, { provisioningOperationId })
    }
    if (activationRow.status === 'dead_letter') {
      await resetOutboxEventForRetry(tx, activationRow.id)
      eventIdToProcess = activationRow.id
    }
  })

  if (eventIdToProcess) {
    await processOutboxEventById(eventIdToProcess, enterpriseOwnerClaimOutboxHandlers)
  } else if (provisioningOperationId) {
    const provisioning = await getEnterpriseProvisioningById(provisioningOperationId)
    if (provisioning?.status === 'dead_letter') {
      if (!retryActor) throw new Error('Enterprise owner claim retry actor is missing')
      await retryEnterpriseProvisioning(provisioningOperationId, retryActor)
    }
  }
  const view = await getEnterpriseOwnerClaimView(claimId)
  if (!view) throw new EnterpriseProvisioningError('Owner invitation not found')
  return view
}

export async function revokeEnterpriseOwnerClaim(
  claimId: string,
  actor: { id: string | null; name: string; email: string | null }
): Promise<EnterpriseOwnerClaimView> {
  const revokedAt = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.id, claimId),
          eq(outboxEvent.eventType, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE)
        )
      )
      .for('update')
      .limit(1)
    const payload = parseClaimPayload(row?.payload)
    if (!row || !payload) throw new EnterpriseProvisioningError('Owner invitation not found')
    if (payload.acceptance) {
      throw new EnterpriseProvisioningError(
        'The owner has already accepted; continue or retry Enterprise activation instead'
      )
    }
    if (payload.revokedAt) return payload.revokedAt

    const nextRevokedAt = new Date().toISOString()
    await tx
      .update(outboxEvent)
      .set({
        payload: sql`(coalesce(${outboxEvent.payload}::jsonb, '{}'::jsonb) || ${JSON.stringify({ revokedAt: nextRevokedAt })}::jsonb)::json`,
        status: 'completed',
        lastError: null,
        lockedAt: null,
        processedAt: new Date(nextRevokedAt),
      })
      .where(eq(outboxEvent.id, claimId))
    return nextRevokedAt
  })

  const view = await getEnterpriseOwnerClaimView(claimId)
  if (!view) throw new EnterpriseProvisioningError('Owner invitation not found')
  await recordAuditOnce(`${claimId}:revoked`, {
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.INVITATION_REVOKED,
    resourceType: AuditResourceType.SUBSCRIPTION,
    resourceId: claimId,
    description: `Revoked Enterprise owner invitation for ${view.ownerEmail}`,
    metadata: {
      ownerEmail: view.ownerEmail,
      organizationName: view.organizationName,
      revokedAt,
    },
  })
  return view
}

async function resetOutboxEventForRetry(executor: DbOrTx, eventId: string): Promise<void> {
  await executor
    .update(outboxEvent)
    .set({
      status: 'pending',
      attempts: 0,
      lastError: null,
      availableAt: new Date(),
      lockedAt: null,
      processedAt: null,
    })
    .where(eq(outboxEvent.id, eventId))
}

async function getClaimWorkspacePreview(ownerUserId: string) {
  const rows = await db
    .select({ id: workspace.id, name: workspace.name, archivedAt: workspace.archivedAt })
    .from(workspace)
    .where(ownedAttachableWorkspacesWhere({ userId: ownerUserId, includeArchived: true }))
    .orderBy(workspace.name, workspace.id)
    .limit(MAX_ENTERPRISE_WORKSPACE_SELECTION + 1)
  if (rows.length > MAX_ENTERPRISE_WORKSPACE_SELECTION) {
    throw new EnterpriseOwnerClaimWorkspaceLimitError(
      `This account has more than ${MAX_ENTERPRISE_WORKSPACE_SELECTION.toLocaleString()} personal workspaces. Contact support before accepting so none are omitted.`
    )
  }
  return {
    workspacesToMove: rows.map((row) => ({
      id: row.id,
      name: row.name,
      archived: row.archivedAt !== null,
    })),
    createsDefaultWorkspace: rows.length === 0,
  }
}

export async function getEnterpriseOwnerClaimDetails(params: {
  claimId: string
  token: string
  userId: string
  userEmail: string
}): Promise<EnterpriseOwnerClaimDetails | null> {
  const row = await getClaimRow(params.claimId)
  if (!row) return null
  const payload = parseClaimPayload(row.payload)
  if (!payload || !safeCompare(payload.token, params.token)) return null
  if (normalizeEmail(params.userEmail) !== payload.request.ownerEmail) {
    throw new EnterpriseOwnerClaimEmailMismatchError(
      'This invitation was sent to a different email address'
    )
  }
  const view = await toClaimView(row, payload)
  const workspacePreview =
    payload.acceptance || payload.revokedAt ? null : await getClaimWorkspacePreview(params.userId)
  let acceptanceReview: EnterpriseOwnerClaimDetails['acceptanceReview'] = null
  if (workspacePreview) {
    const [existingMembership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, params.userId))
      .limit(1)
    if (existingMembership) {
      acceptanceReview = {
        canAccept: false,
        reason: 'This account already belongs to an organization and cannot accept ownership.',
        requiredSeats: null,
      }
    } else if (
      payload.request.invitations.length > 0 &&
      Math.max(1, workspacePreview.workspacesToMove.length) > MAX_INVITE_WORKSPACES
    ) {
      acceptanceReview = {
        canAccept: false,
        reason: `This setup invites teammates to more than ${MAX_INVITE_WORKSPACES} workspaces. Ask the Admin team to send teammate invitations after activation instead.`,
        requiredSeats: null,
      }
    } else {
      const seatRequirement = await getEnterpriseIssuanceSeatRequirement({
        executor: db,
        organizationId: null,
        workspaceIds: workspacePreview.workspacesToMove.map((workspaceRow) => workspaceRow.id),
        invitationEmails: payload.request.invitations.map((invitation) => invitation.email),
        existingSeatEmails: [payload.request.ownerEmail],
      })
      try {
        await assertEnterpriseInvitationEligibility({
          executor: db,
          organizationId: null,
          invitationEmails: payload.request.invitations.map((invitation) => invitation.email),
        })
        acceptanceReview = {
          canAccept: payload.request.seats >= seatRequirement.requiredSeats,
          reason:
            payload.request.seats >= seatRequirement.requiredSeats
              ? null
              : `This setup now requires ${seatRequirement.requiredSeats} seats. Ask the Admin team to issue a larger plan.`,
          requiredSeats: seatRequirement.requiredSeats,
        }
      } catch (error) {
        if (!(error instanceof EnterpriseProvisioningError)) throw error
        acceptanceReview = {
          canAccept: false,
          reason: error.message,
          requiredSeats: seatRequirement.requiredSeats,
        }
      }
    }
  }
  return {
    ...view,
    invoiceAmountUsd: payload.request.invoiceAmountCents / 100,
    billingInterval: payload.request.billingInterval,
    seats: payload.request.seats,
    invitations: payload.request.invitations.length,
    workspacePreview,
    acceptanceReview,
  }
}

function sameWorkspaceSet(left: string[], right: string[]): boolean {
  return [...left].sort().join() === [...right].sort().join()
}

function claimOrganizationSlug(name: string, claimId: string): string {
  const base = slugify(name).slice(0, 80)
  return `${base || 'organization'}-${claimId.replace(/[^a-z0-9]/g, '')}`
}

export async function acceptEnterpriseOwnerClaim(params: {
  claimId: string
  token: string
  userId: string
  userEmail: string
  userName: string | null | undefined
  disclosedWorkspaceIds: string[]
  disclosedCreatesDefaultWorkspace: boolean
}): Promise<AcceptEnterpriseOwnerClaimResult> {
  let activationEventId: string | null = null
  try {
    const acceptance = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.id, params.claimId),
            eq(outboxEvent.eventType, ENTERPRISE_OWNER_CLAIM_EVENT_TYPE)
          )
        )
        .for('update')
        .limit(1)
      if (!row) return { success: false as const, kind: 'not-found' as const }
      const payload = parseClaimPayload(row.payload)
      if (!payload || !safeCompare(payload.token, params.token)) {
        return { success: false as const, kind: 'invalid-token' as const }
      }
      if (normalizeEmail(params.userEmail) !== payload.request.ownerEmail) {
        return { success: false as const, kind: 'email-mismatch' as const }
      }
      if (payload.acceptance) {
        if (payload.acceptance.ownerUserId !== params.userId) {
          return { success: false as const, kind: 'email-mismatch' as const }
        }
        return {
          success: true as const,
          activationEventId: payload.acceptance.activationEventId,
          acceptance: payload.acceptance,
          createdWorkspace: null,
        }
      }
      if (payload.revokedAt) {
        return { success: false as const, kind: 'revoked' as const }
      }
      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        return { success: false as const, kind: 'expired' as const }
      }

      await acquireUserBillingIdentityLock(tx, params.userId)
      const [existingMembership] = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, params.userId))
        .limit(1)
      if (existingMembership) {
        return { success: false as const, kind: 'already-in-organization' as const }
      }
      const currentWorkspaces = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(ownedAttachableWorkspacesWhere({ userId: params.userId, includeArchived: true }))
        .orderBy(workspace.id)
        .limit(MAX_ENTERPRISE_WORKSPACE_SELECTION + 1)
      if (currentWorkspaces.length > MAX_ENTERPRISE_WORKSPACE_SELECTION) {
        return { success: false as const, kind: 'workspace-limit' as const }
      }
      const currentWorkspaceIds = currentWorkspaces.map((workspaceRow) => workspaceRow.id)
      const createsDefaultWorkspace = currentWorkspaceIds.length === 0
      if (
        createsDefaultWorkspace !== params.disclosedCreatesDefaultWorkspace ||
        !sameWorkspaceSet(currentWorkspaceIds, params.disclosedWorkspaceIds)
      ) {
        return { success: false as const, kind: 'disclosure-outdated' as const }
      }

      let workspaceIds = currentWorkspaceIds
      let createdWorkspace: { id: string; name: string } | null = null
      if (
        payload.request.invitations.length > 0 &&
        Math.max(1, workspaceIds.length) > MAX_INVITE_WORKSPACES
      ) {
        return { success: false as const, kind: 'workspace-invitation-limit' as const }
      }

      const seatRequirement = await getEnterpriseIssuanceSeatRequirement({
        executor: tx,
        organizationId: null,
        workspaceIds,
        invitationEmails: payload.request.invitations.map((invitation) => invitation.email),
        existingSeatEmails: [payload.request.ownerEmail],
      })
      if (payload.request.seats < seatRequirement.requiredSeats) {
        return {
          success: false as const,
          kind: 'insufficient-seats' as const,
          message: `This setup now requires ${seatRequirement.requiredSeats} seats because of invitations already attached to the owner's workspaces. Ask the Admin team to issue a larger plan.`,
        }
      }
      await assertEnterpriseInvitationEligibility({
        executor: tx,
        organizationId: null,
        invitationEmails: payload.request.invitations.map((invitation) => invitation.email),
      })

      const [verifiedOwner] = await tx
        .update(user)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(
          and(eq(user.id, params.userId), eq(foldedEmail(user.email), payload.request.ownerEmail))
        )
        .returning({ id: user.id })
      if (!verifiedOwner) {
        return { success: false as const, kind: 'email-mismatch' as const }
      }

      if (createsDefaultWorkspace) {
        const defaultWorkspace = await createDefaultPersonalWorkspaceInTransaction(tx, {
          userId: params.userId,
          userName: params.userName,
        })
        createdWorkspace = { id: defaultWorkspace.id, name: defaultWorkspace.name }
        workspaceIds = [defaultWorkspace.id]
      }

      const { organizationId } = await createOrganizationWithOwnerTx(tx, {
        ownerUserId: params.userId,
        name: payload.request.organizationName,
        slug: claimOrganizationSlug(payload.request.organizationName, params.claimId),
        metadata: { createdForEnterpriseOwnerClaim: params.claimId },
      })
      const acceptedAt = new Date()
      const nextActivationEventId = generateId()
      const nextAcceptance: z.infer<typeof enterpriseOwnerClaimAcceptanceSchema> = {
        acceptedAt: acceptedAt.toISOString(),
        ownerUserId: params.userId,
        organizationId,
        workspaceIds,
        reportingPeriodAnchorDate: acceptedAt.toISOString().slice(0, 10),
        activationEventId: nextActivationEventId,
        createdDefaultWorkspaceId: createdWorkspace?.id ?? null,
      }
      await patchOutboxEventPayload(tx, params.claimId, { acceptance: nextAcceptance })
      await enqueueOutboxEvent(
        tx,
        ENTERPRISE_OWNER_ACTIVATION_EVENT_TYPE,
        { claimId: params.claimId } satisfies EnterpriseOwnerActivationPayload,
        { id: nextActivationEventId }
      )
      return {
        success: true as const,
        activationEventId: nextActivationEventId,
        acceptance: nextAcceptance,
        createdWorkspace,
      }
    })

    if (!acceptance.success) return acceptance
    activationEventId = acceptance.activationEventId
    if (acceptance.createdWorkspace) {
      emitWorkspaceCreatedPlatformEvent({
        workspaceId: acceptance.createdWorkspace.id,
        userId: params.userId,
        name: acceptance.createdWorkspace.name,
      })
    }
    await processOutboxEventById(activationEventId, enterpriseOwnerClaimOutboxHandlers)
    const claim = await getEnterpriseOwnerClaimView(params.claimId)
    if (!claim) return { success: false, kind: 'not-found' }
    await recordAuditOnce(`${params.claimId}:accepted`, {
      actorId: params.userId,
      actorName: params.userName ?? undefined,
      actorEmail: params.userEmail,
      action: AuditAction.ORGANIZATION_CREATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: claim.organizationId ?? params.claimId,
      description: `Accepted Enterprise ownership for ${claim.organizationName}`,
      metadata: {
        claimId: params.claimId,
        organizationId: claim.organizationId,
        workspaceCount: acceptance.acceptance.workspaceIds.length,
        createdDefaultWorkspaceId: acceptance.acceptance.createdDefaultWorkspaceId,
      },
    })
    return { success: true, claim, redirectPath: APP_ENTRY_PATH }
  } catch (error) {
    logger.error('Failed to accept Enterprise owner claim', {
      claimId: params.claimId,
      activationEventId,
      error,
    })
    return {
      success: false,
      kind: 'server-error',
      message:
        error instanceof EnterpriseProvisioningError
          ? error.message
          : 'Failed to activate Enterprise ownership',
    }
  }
}

const sendEnterpriseOwnerClaimEmail: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseOwnerClaimPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise owner-claim payload')
  const payload = parsed.data
  if (payload.delivery || payload.acceptance || payload.revokedAt) return
  const inviteLink = `${getBaseUrl()}/enterprise/claim/${context.eventId}?token=${payload.token}`
  const html = await renderEnterpriseOwnerInvitationEmail(
    payload.request.organizationName,
    inviteLink,
    ENTERPRISE_OWNER_CLAIM_EXPIRY_DAYS
  )
  const result = await sendEmail({
    to: payload.request.ownerEmail,
    subject: getEmailSubject('enterprise-owner-invitation'),
    html,
    emailType: 'transactional',
  })
  if (!result.success) throw new Error(result.message || 'Failed to send owner invitation')
  await context.checkpointPayload({ delivery: { sentAt: new Date().toISOString() } })
}

const activateEnterpriseOwnerClaim: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseOwnerActivationPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise owner activation payload')
  let provisioningOperationId = parsed.data.provisioningOperationId
  const row = await getClaimRow(parsed.data.claimId)
  const claim = row && parseClaimPayload(row.payload)
  if (!row || !claim?.acceptance) throw new Error('Enterprise owner claim is not accepted')

  if (!provisioningOperationId) {
    const request = claim.request
    const provisioning = await issueEnterpriseProvisioning({
      ownerUserId: claim.acceptance.ownerUserId,
      organizationName: request.organizationName,
      invoiceAmountUsd: request.invoiceAmountCents / 100,
      billingInterval: request.billingInterval,
      reportingPeriodAnchorDate: claim.acceptance.reportingPeriodAnchorDate,
      workspaceIds: claim.acceptance.workspaceIds,
      invitations: request.invitations,
      usageLimitCredits: request.usageLimitCredits,
      seats: request.seats,
      ...(request.concurrencyLimit !== undefined
        ? { concurrencyLimit: request.concurrencyLimit }
        : {}),
      ...(request.workflowExecutionTimeoutSeconds !== undefined
        ? { workflowExecutionTimeoutSeconds: request.workflowExecutionTimeoutSeconds }
        : {}),
      pausePaymentCollection: request.pausePaymentCollection,
      requestedByEmail: request.requestedByEmail,
      requestedByUserId: request.requestedByUserId,
      requestedByName: request.requestedByName,
    })
    provisioningOperationId = provisioning.id
    await context.checkpointPayload({ provisioningOperationId })
  }
  await patchOutboxEventPayload(db, parsed.data.claimId, { provisioningOperationId })
}

export const enterpriseOwnerClaimOutboxHandlers = {
  [ENTERPRISE_OWNER_CLAIM_EVENT_TYPE]: sendEnterpriseOwnerClaimEmail,
  [ENTERPRISE_OWNER_ACTIVATION_EVENT_TYPE]: activateEnterpriseOwnerClaim,
} as const satisfies OutboxHandlerRegistry
