import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, outboxEvent, subscription, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import {
  acquireOrganizationMutationLock,
  ensureUserInOrganizationTx,
  transferUserBetweenOrganizations,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import {
  continueOutboxHandler,
  enqueueOutboxEvent,
  type OutboxHandler,
  outboxEventHasSourceOperationId,
  outboxPayloadHasSourceOperationId,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import {
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE,
  moveWorkspaceToOrganization,
} from '@/lib/workspaces/admin-move'
import { ownedAttachableWorkspacesWhere } from '@/lib/workspaces/organization-workspaces'

export const ADMIN_MEMBER_OPERATION_EVENT_TYPE = 'admin.organization-member-operation'
const MEMBER_OPERATION_WORKSPACE_BATCH_SIZE = 10
const ADMIN_API_AUDIT_EMAIL = 'admin-api@internal.simstudio.ai'
const logger = createLogger('AdminMemberOperation')

const memberOperationRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['admin', 'member']),
    usageLimitDollars: z.number().min(0).nullable().optional(),
    workspaceIds: z.array(z.string().min(1)).max(1_000),
    sourceOrganizationId: z.string().min(1).nullable(),
    actor: z.object({
      id: z.string().min(1).nullable(),
      name: z.string().min(1),
      email: z.string().email().nullable(),
    }),
  })
  .strict()

const memberOperationProgressSchema = z
  .object({
    memberId: z.string().min(1).nullable().default(null),
    transferredFromOrganizationId: z.string().min(1).nullable().default(null),
    nextWorkspaceIndex: z.number().int().min(0).default(0),
    currentWorkspaceId: z.string().min(1).nullable().default(null),
  })
  .strict()

const memberOperationPayloadSchema = z
  .object({
    request: memberOperationRequestSchema,
    progress: memberOperationProgressSchema.default({
      memberId: null,
      transferredFromOrganizationId: null,
      nextWorkspaceIndex: 0,
      currentWorkspaceId: null,
    }),
  })
  .strict()

type MemberOperationPayload = z.infer<typeof memberOperationPayloadSchema>

export interface AdminMemberOperationActor {
  id: string | null
  name: string
  email: string | null
}

export interface AdminMemberOperationView {
  id: string
  organizationId: string
  userId: string
  status: 'pending' | 'processing' | 'dead_letter' | 'applied'
  memberId: string | null
  transferredFromOrganizationId: string | null
  error: string | null
  createdAt: string
  workspaceMoves: {
    selected: number
    moved: number
    pending: number
    failedCount: number
    failed: Array<{ workspaceId: string; error: string }>
  }
  followUpJobs: {
    selected: number
    completed: number
    pending: number
    failedCount: number
    failed: Array<{
      eventId: string
      kind: 'migrated_invitation_email'
      subjectId: string
      error: string | null
    }>
  }
}

function parseMemberOperationPayload(value: unknown): MemberOperationPayload {
  const parsed = memberOperationPayloadSchema.safeParse(value)
  if (!parsed.success) throw new Error('Admin member operation payload is invalid')
  return parsed.data
}

function getMemberFollowUpSubject(eventType: string, payload: unknown): string | null {
  if (
    eventType !== MIGRATED_INVITATION_EMAIL_EVENT_TYPE ||
    !payload ||
    typeof payload !== 'object'
  ) {
    return null
  }
  const invitationId = (payload as Record<string, unknown>).invitationId
  return typeof invitationId === 'string' && invitationId.length > 0 ? invitationId : null
}

async function getMemberOperationFollowUpJobs(
  operationId: string,
  executor: DbOrTx = db
): Promise<AdminMemberOperationView['followUpJobs']> {
  const [progress] = await executor
    .select({
      selected: count(),
      completed: sql<number>`count(*) filter (where ${outboxEvent.status} = 'completed')`.mapWith(
        Number
      ),
      failed: sql<number>`count(*) filter (where ${outboxEvent.status} = 'dead_letter')`.mapWith(
        Number
      ),
    })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, MIGRATED_INVITATION_EMAIL_EVENT_TYPE),
        outboxEventHasSourceOperationId(operationId)
      )
    )
  const selected = progress?.selected ?? 0
  const completed = progress?.completed ?? 0
  const failedCount = progress?.failed ?? 0
  const failedRows =
    failedCount > 0
      ? await executor
          .select({
            eventId: outboxEvent.id,
            invitationId: sql<string | null>`${outboxEvent.payload} ->> 'invitationId'`,
            error: outboxEvent.lastError,
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, MIGRATED_INVITATION_EMAIL_EVENT_TYPE),
              eq(outboxEvent.status, 'dead_letter'),
              outboxEventHasSourceOperationId(operationId)
            )
          )
          .orderBy(outboxEvent.createdAt, outboxEvent.id)
          .limit(100)
      : []
  return {
    selected,
    completed,
    pending: Math.max(0, selected - completed - failedCount),
    failedCount,
    failed: failedRows.flatMap((row) =>
      row.invitationId
        ? [
            {
              eventId: row.eventId,
              kind: 'migrated_invitation_email' as const,
              subjectId: row.invitationId,
              error: row.error,
            },
          ]
        : []
    ),
  }
}

async function toMemberOperationView(
  row: Pick<
    typeof outboxEvent.$inferSelect,
    'id' | 'status' | 'lastError' | 'createdAt' | 'payload'
  >,
  executor: DbOrTx = db
): Promise<AdminMemberOperationView> {
  const payload = parseMemberOperationPayload(row.payload)
  const followUpJobs = await getMemberOperationFollowUpJobs(row.id, executor)
  const failed =
    row.status === 'dead_letter' && payload.progress.currentWorkspaceId
      ? [
          {
            workspaceId: payload.progress.currentWorkspaceId,
            error: row.lastError ?? 'Workspace move failed',
          },
        ]
      : []
  return {
    id: row.id,
    organizationId: payload.request.organizationId,
    userId: payload.request.userId,
    status:
      row.status === 'completed' ? 'applied' : (row.status as AdminMemberOperationView['status']),
    memberId: payload.progress.memberId,
    transferredFromOrganizationId: payload.progress.transferredFromOrganizationId,
    error: row.lastError,
    createdAt: row.createdAt.toISOString(),
    workspaceMoves: {
      selected: payload.request.workspaceIds.length,
      moved: payload.progress.nextWorkspaceIndex,
      pending: Math.max(
        0,
        payload.request.workspaceIds.length - payload.progress.nextWorkspaceIndex - failed.length
      ),
      failedCount: failed.length,
      failed,
    },
    followUpJobs,
  }
}

function sameMemberOperationRequest(
  existing: MemberOperationPayload['request'],
  requested: Pick<
    MemberOperationPayload['request'],
    'organizationId' | 'userId' | 'role' | 'usageLimitDollars' | 'workspaceIds'
  >
): boolean {
  return (
    existing.organizationId === requested.organizationId &&
    existing.userId === requested.userId &&
    existing.role === requested.role &&
    existing.usageLimitDollars === requested.usageLimitDollars &&
    JSON.stringify(existing.workspaceIds) === JSON.stringify(requested.workspaceIds)
  )
}

export async function startAdminMemberOperation(
  operationId: string,
  organizationId: string,
  values: {
    userId: string
    role: 'admin' | 'member'
    usageLimitDollars?: number | null
    personalWorkspaceIds?: string[]
  },
  actor: AdminMemberOperationActor
): Promise<AdminMemberOperationView> {
  const workspaceIds = [...new Set(values.personalWorkspaceIds ?? [])].sort()
  if (workspaceIds.length > 1_000) throw new Error('At most 1,000 workspaces can be moved')

  return db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    await acquireUserBillingIdentityLock(tx, values.userId)

    const [existingOperation] = await tx
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, operationId))
      .for('update')
      .limit(1)

    const [[destination], [target]] = await Promise.all([
      tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1),
      tx
        .select({
          id: user.id,
          memberId: member.id,
          role: member.role,
          organizationId: member.organizationId,
        })
        .from(user)
        .leftJoin(member, eq(member.userId, user.id))
        .where(eq(user.id, values.userId))
        .limit(1),
    ])
    if (!destination) throw new Error('Destination organization not found')
    if (!target) throw new Error('User not found')

    const request: MemberOperationPayload['request'] = {
      organizationId,
      userId: values.userId,
      role: values.role,
      ...(values.usageLimitDollars !== undefined
        ? { usageLimitDollars: values.usageLimitDollars }
        : {}),
      workspaceIds,
      sourceOrganizationId:
        target.organizationId && target.organizationId !== organizationId
          ? target.organizationId
          : null,
      actor: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
      },
    }

    if (existingOperation) {
      if (existingOperation.eventType !== ADMIN_MEMBER_OPERATION_EVENT_TYPE) {
        throw new Error('Operation ID is already used by another operation')
      }
      const existingPayload = parseMemberOperationPayload(existingOperation.payload)
      if (!sameMemberOperationRequest(existingPayload.request, request)) {
        throw new Error('Operation ID is already bound to different member-operation parameters')
      }
      if (existingOperation.status === 'dead_letter') {
        const [requeued] = await tx
          .update(outboxEvent)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            lockedAt: null,
            processedAt: null,
            availableAt: new Date(),
          })
          .where(eq(outboxEvent.id, operationId))
          .returning()
        return toMemberOperationView(requeued, tx)
      }
      return toMemberOperationView(existingOperation, tx)
    }

    if (target.organizationId === organizationId) {
      throw new Error('User is already a member of this organization')
    }
    if (target.role === 'owner') {
      throw new Error('Transfer organization ownership before moving this user')
    }
    if (workspaceIds.length > 0) {
      const selectable = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            ownedAttachableWorkspacesWhere({ userId: values.userId, includeArchived: true }),
            inArray(workspace.id, workspaceIds)
          )
        )
      if (selectable.length !== workspaceIds.length) {
        throw new Error('One or more selected personal workspaces can no longer be moved')
      }
    }

    const [unfinishedOperation] = await tx
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ADMIN_MEMBER_OPERATION_EVENT_TYPE),
          inArray(outboxEvent.status, ['pending', 'processing', 'dead_letter']),
          sql`${outboxEvent.payload} #>> '{request,userId}' = ${values.userId}`,
          sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
        )
      )
      .limit(1)
    if (unfinishedOperation) {
      throw new Error('This member already has an unfinished add or transfer operation')
    }

    const payload: MemberOperationPayload = {
      request,
      progress: {
        memberId: null,
        transferredFromOrganizationId: null,
        nextWorkspaceIndex: 0,
        currentWorkspaceId: null,
      },
    }
    await enqueueOutboxEvent(tx, ADMIN_MEMBER_OPERATION_EVENT_TYPE, payload, {
      id: operationId,
      maxAttempts: 10,
    })
    const [created] = await tx
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, operationId))
      .limit(1)
    if (!created) throw new Error('Member operation was not created')
    return toMemberOperationView(created, tx)
  })
}

export async function getAdminMemberOperation(
  organizationId: string,
  operationId: string
): Promise<AdminMemberOperationView> {
  const [row] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ADMIN_MEMBER_OPERATION_EVENT_TYPE),
        sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
      )
    )
    .limit(1)
  if (!row) throw new Error('Member operation not found')
  return toMemberOperationView(row)
}

export async function retryAdminMemberFollowUpJob(
  organizationId: string,
  operationId: string,
  jobEventId: string,
  actor: AdminMemberOperationActor
): Promise<AdminMemberOperationView> {
  const [operationRow] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ADMIN_MEMBER_OPERATION_EVENT_TYPE),
        sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
      )
    )
    .limit(1)
  if (!operationRow) throw new Error('Member operation not found')

  const retried = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [job] = await tx
      .select({
        eventType: outboxEvent.eventType,
        payload: outboxEvent.payload,
        status: outboxEvent.status,
      })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, jobEventId))
      .for('update')
      .limit(1)
    if (
      !job ||
      getMemberFollowUpSubject(job.eventType, job.payload) === null ||
      !outboxPayloadHasSourceOperationId(job.payload, operationId)
    ) {
      throw new Error('Member-operation follow-up job not found')
    }
    if (job.status !== 'dead_letter') return false
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

  if (retried) {
    await recordAuditOnce(`${operationId}:follow-up-retry:${jobEventId}`, {
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      description: 'Admin retried a member-operation invitation email',
      metadata: { organizationId, operationId, jobEventId },
    })
  }
  return getAdminMemberOperation(organizationId, operationId)
}

async function applyMembership(
  payload: MemberOperationPayload,
  context: Parameters<OutboxHandler<unknown>>[1]
): Promise<MemberOperationPayload['progress']> {
  if (payload.progress.memberId) return payload.progress
  const request = payload.request
  const [currentMembership] = await db
    .select({ id: member.id, role: member.role, organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, request.userId))
    .limit(1)

  let memberId: string
  if (currentMembership?.organizationId === request.organizationId) {
    if (currentMembership.role !== request.role) {
      throw new Error('Member role changed while the durable operation was being recovered')
    }
    memberId = currentMembership.id
  } else if (request.sourceOrganizationId) {
    if (currentMembership?.organizationId !== request.sourceOrganizationId) {
      throw new Error('Member organization changed before the transfer could be applied')
    }
    const transferred = await transferUserBetweenOrganizations({
      userId: request.userId,
      sourceOrganizationId: request.sourceOrganizationId,
      destinationOrganizationId: request.organizationId,
      role: request.role,
      usageLimitDollars: request.usageLimitDollars,
      setBy: request.actor.id ?? undefined,
    })
    if (!transferred.success || !transferred.memberId) {
      throw new Error(transferred.error ?? 'Failed to transfer organization member')
    }
    memberId = transferred.memberId
  } else {
    if (currentMembership) throw new Error('User joined another organization before being added')
    memberId = await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, request.organizationId)
      await acquireUserBillingIdentityLock(tx, request.userId)
      const [organizationSubscription] = await tx
        .select({ plan: subscription.plan })
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, request.organizationId),
            inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
        .orderBy(desc(subscription.periodStart))
        .limit(1)
      const membershipResult = await ensureUserInOrganizationTx(tx, {
        userId: request.userId,
        organizationId: request.organizationId,
        role: request.role,
        skipSeatValidation: organizationSubscription?.plan.startsWith('team') ?? false,
      })
      if (!membershipResult.success || !membershipResult.memberId) {
        throw new Error(membershipResult.error ?? 'Failed to add organization member')
      }
      if (membershipResult.alreadyMember) {
        const [concurrentMembership] = await tx
          .select({ role: member.role })
          .from(member)
          .where(eq(member.id, membershipResult.memberId))
          .for('update')
          .limit(1)
        if (!concurrentMembership) {
          throw new Error('Concurrent organization membership could not be recovered')
        }
        if (concurrentMembership.role === 'owner') {
          throw new Error('Organization ownership changed while the member was being added')
        }
        if (concurrentMembership.role !== request.role) {
          await tx
            .update(member)
            .set({ role: request.role })
            .where(eq(member.id, membershipResult.memberId))
        }
      }
      if (request.usageLimitDollars !== undefined) {
        await setOrgMemberUsageLimit(
          request.organizationId,
          request.userId,
          request.usageLimitDollars,
          request.actor.id ?? undefined,
          tx
        )
      }
      return membershipResult.memberId
    })
  }

  const progress = {
    ...payload.progress,
    memberId,
    transferredFromOrganizationId: request.sourceOrganizationId,
  }
  await context.checkpointPayload({ progress })
  return progress
}

async function ensureMembershipAudits(
  operationId: string,
  payload: MemberOperationPayload,
  progress: MemberOperationPayload['progress']
): Promise<void> {
  const request = payload.request
  if (request.sourceOrganizationId) {
    await recordAuditOnce(`${operationId}:member-removed`, {
      actorId: request.actor.id,
      actorName: request.actor.name,
      actorEmail: request.actor.email,
      action: AuditAction.ORG_MEMBER_REMOVED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: request.sourceOrganizationId,
      description: 'Admin transferred organization member out',
      metadata: {
        targetUserId: request.userId,
        destinationOrganizationId: request.organizationId,
        operationId,
      },
    })
  }
  await recordAuditOnce(`${operationId}:member-added`, {
    actorId: request.actor.id,
    actorName: request.actor.name,
    actorEmail: request.actor.email,
    action: AuditAction.ORG_MEMBER_ADDED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: request.organizationId,
    description: request.sourceOrganizationId
      ? `Admin transferred organization member as ${request.role}`
      : `Admin added organization member as ${request.role}`,
    metadata: {
      targetUserId: request.userId,
      memberId: progress.memberId,
      transferredFromOrganizationId: request.sourceOrganizationId,
      operationId,
    },
  })
}

export const processAdminMemberOperation: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = parseMemberOperationPayload(rawPayload)
  const progress = await applyMembership(payload, context)
  await ensureMembershipAudits(context.eventId, payload, progress)

  for (const organizationId of [requestSource(payload), payload.request.organizationId]) {
    if (!organizationId) continue
    try {
      await reconcileOrganizationSeats({
        organizationId,
        reason:
          organizationId === payload.request.organizationId
            ? 'admin-member-added'
            : 'admin-member-transferred-out',
        actorId: payload.request.actor.id ?? undefined,
      })
    } catch (error) {
      logger.warn('Member operation seat reconciliation will self-heal', {
        organizationId,
        operationId: context.eventId,
        error: getErrorMessage(error),
      })
    }
  }
  try {
    await syncUsageLimitsFromSubscription(payload.request.userId)
  } catch (error) {
    logger.warn('Member operation usage-limit reconciliation will self-heal', {
      userId: payload.request.userId,
      operationId: context.eventId,
      error: getErrorMessage(error),
    })
  }

  let nextWorkspaceIndex = progress.nextWorkspaceIndex
  const batchEnd = Math.min(
    payload.request.workspaceIds.length,
    nextWorkspaceIndex + MEMBER_OPERATION_WORKSPACE_BATCH_SIZE
  )
  while (nextWorkspaceIndex < batchEnd) {
    const currentWorkspaceId = payload.request.workspaceIds[nextWorkspaceIndex]
    await context.checkpointPayload({
      progress: { ...progress, nextWorkspaceIndex, currentWorkspaceId },
    })
    await moveWorkspaceToOrganization({
      workspaceId: currentWorkspaceId,
      destinationOrganizationId: payload.request.organizationId,
      adminEmail: payload.request.actor.email ?? ADMIN_API_AUDIT_EMAIL,
      auditActor: payload.request.actor,
      auditOperationId: context.eventId,
      operationCorrelationId: context.eventId,
      expectedOwnerId: payload.request.userId,
    })
    nextWorkspaceIndex += 1
    await context.checkpointPayload({
      progress: { ...progress, nextWorkspaceIndex, currentWorkspaceId: null },
    })
  }

  if (nextWorkspaceIndex < payload.request.workspaceIds.length) {
    return continueOutboxHandler('Continuing bounded member workspace moves')
  }
}

function requestSource(payload: MemberOperationPayload): string | null {
  return payload.request.sourceOrganizationId
}

export const adminMemberOperationOutboxHandlers = {
  [ADMIN_MEMBER_OPERATION_EVENT_TYPE]: processAdminMemberOperation,
} as const
