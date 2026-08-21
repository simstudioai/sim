import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { member, outboxEvent, user, workspace } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE,
  enterpriseInvitePeoplePayloadSchema,
} from '@/lib/billing/enterprise-outbox'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import {
  deferOutboxHandler,
  enqueueOutboxEvent,
  enqueueOutboxEvents,
  type OutboxHandler,
} from '@/lib/core/outbox/service'
import {
  DIRECT_GRANT_EMAIL_EVENT_TYPE,
  type DirectGrantEmailPayload,
} from '@/lib/invitations/direct-grant'
import { MAX_INVITE_EMAILS, MAX_INVITE_WORKSPACES } from '@/lib/invitations/limits'

export const ADMIN_INVITATION_OPERATION_EVENT_TYPE = 'admin.organization-invitation-operation'
const MAX_INVITATION_OPERATION_FAILURE_DETAILS = 100

const adminInvitationOperationRequestSchema = z.object({
  organizationId: z.string().min(1),
  ownerUserId: z.string().min(1),
  emails: z.array(z.string().email()).min(1).max(MAX_INVITE_EMAILS),
  workspaceIds: z.array(z.string().min(1)).min(1).max(MAX_INVITE_WORKSPACES),
  role: z.enum(['admin', 'member']),
  permission: z.enum(['admin', 'write', 'read']),
  actor: z.object({
    id: z.string().min(1).nullable(),
    name: z.string().min(1),
    email: z.string().email().nullable(),
  }),
})

const adminInvitationOperationPayloadSchema = z.object({
  request: adminInvitationOperationRequestSchema,
})

type AdminInvitationOperationPayload = z.infer<typeof adminInvitationOperationPayloadSchema>

export interface AdminInvitationOperationView {
  id: string
  organizationId: string
  status: 'pending' | 'processing' | 'dead_letter' | 'applied'
  error: string | null
  createdAt: string
  invitations: {
    selected: number
    completed: number
    pending: number
    failedCount: number
    sent: string[]
    added: string[]
    unchanged: string[]
    failed: Array<{ eventId: string; email: string; error: string | null }>
  }
  notifications: {
    selected: number
    completed: number
    pending: number
    failedCount: number
    failed: Array<{ eventId: string; email: string; workspaceId: string; error: string | null }>
  }
}

export function parseAdminInvitationOperationPayload(
  payload: unknown
): AdminInvitationOperationPayload | null {
  const parsed = adminInvitationOperationPayloadSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

function sameRequest(
  existing: AdminInvitationOperationPayload['request'],
  requested: AdminInvitationOperationPayload['request']
): boolean {
  return (
    existing.organizationId === requested.organizationId &&
    existing.ownerUserId === requested.ownerUserId &&
    existing.role === requested.role &&
    existing.permission === requested.permission &&
    JSON.stringify(existing.emails) === JSON.stringify(requested.emails) &&
    JSON.stringify(existing.workspaceIds) === JSON.stringify(requested.workspaceIds)
  )
}

function operationStatus(status: string): AdminInvitationOperationView['status'] {
  if (status === 'completed') return 'applied'
  if (status === 'dead_letter') return 'dead_letter'
  return status === 'processing' ? 'processing' : 'pending'
}

async function buildAdminInvitationOperationView(
  row: typeof outboxEvent.$inferSelect
): Promise<AdminInvitationOperationView> {
  const payload = parseAdminInvitationOperationPayload(row.payload)
  if (!payload) throw new Error('Invitation operation payload is invalid')
  const operationIdExpression = sql<string>`${outboxEvent.payload} ->> 'provisioningOperationId'`
  const invitationRows = await db
    .select({
      id: outboxEvent.id,
      status: outboxEvent.status,
      payload: outboxEvent.payload,
      error: outboxEvent.lastError,
    })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE),
        eq(operationIdExpression, row.id)
      )
    )
    .orderBy(outboxEvent.createdAt, outboxEvent.id)
    .limit(MAX_INVITE_EMAILS)
  const notificationOperationIdExpression = sql<string>`${outboxEvent.payload} ->> 'sourceOperationId'`
  const [notificationTotals] = await db
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
        eq(outboxEvent.eventType, DIRECT_GRANT_EMAIL_EVENT_TYPE),
        eq(notificationOperationIdExpression, row.id)
      )
    )
  const notificationFailureRows =
    (notificationTotals?.failed ?? 0) > 0
      ? await db
          .select({
            id: outboxEvent.id,
            payload: outboxEvent.payload,
            error: outboxEvent.lastError,
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, DIRECT_GRANT_EMAIL_EVENT_TYPE),
              eq(notificationOperationIdExpression, row.id),
              eq(outboxEvent.status, 'dead_letter')
            )
          )
          .orderBy(outboxEvent.createdAt, outboxEvent.id)
          .limit(MAX_INVITATION_OPERATION_FAILURE_DETAILS)
      : []

  const sent: string[] = []
  const added: string[] = []
  const unchanged: string[] = []
  const failed: AdminInvitationOperationView['invitations']['failed'] = []
  let invitationCompleted = 0
  let invitationFailed = 0
  for (const invitationRow of invitationRows) {
    const child = enterpriseInvitePeoplePayloadSchema.safeParse(invitationRow.payload)
    if (!child.success) continue
    if (invitationRow.status === 'completed') {
      invitationCompleted += 1
      const outcome = child.data.delivery?.outcome ?? 'sent'
      if (outcome === 'sent') sent.push(child.data.email)
      else if (outcome === 'added') added.push(child.data.email)
      else unchanged.push(child.data.email)
    } else if (invitationRow.status === 'dead_letter') {
      invitationFailed += 1
      failed.push({
        eventId: invitationRow.id,
        email: child.data.email,
        error: invitationRow.error,
      })
    }
  }

  const notificationSelected = notificationTotals?.selected ?? 0
  const notificationCompleted = notificationTotals?.completed ?? 0
  const notificationFailed = notificationTotals?.failed ?? 0
  return {
    id: row.id,
    organizationId: payload.request.organizationId,
    status: operationStatus(row.status),
    error: row.lastError,
    createdAt: row.createdAt.toISOString(),
    invitations: {
      selected: payload.request.emails.length,
      completed: invitationCompleted,
      pending: Math.max(0, payload.request.emails.length - invitationCompleted - invitationFailed),
      failedCount: invitationFailed,
      sent,
      added,
      unchanged,
      failed,
    },
    notifications: {
      selected: notificationSelected,
      completed: notificationCompleted,
      pending: Math.max(0, notificationSelected - notificationCompleted - notificationFailed),
      failedCount: notificationFailed,
      failed: notificationFailureRows.flatMap((failure) => {
        const notification = failure.payload as Partial<DirectGrantEmailPayload>
        return typeof notification.email === 'string' &&
          typeof notification.workspaceId === 'string'
          ? [
              {
                eventId: failure.id,
                email: notification.email,
                workspaceId: notification.workspaceId,
                error: failure.error,
              },
            ]
          : []
      }),
    },
  }
}

export async function createAdminInvitationOperation(input: {
  operationId: string
  organizationId: string
  emails: string[]
  workspaceIds: string[]
  role: 'admin' | 'member'
  permission: 'admin' | 'write' | 'read'
  actor: { id: string | null; name: string; email: string | null }
}): Promise<AdminInvitationOperationView> {
  const emails = input.emails.map(normalizeEmail).sort()
  if (new Set(emails).size !== emails.length) {
    throw new Error('Each invitation email must be unique')
  }
  const workspaceIds = [...new Set(input.workspaceIds)].sort()
  const row = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, input.organizationId)
    const [existing] = await tx
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, input.operationId))
      .for('update')
      .limit(1)
    if (existing) {
      const payload = parseAdminInvitationOperationPayload(existing.payload)
      if (!payload || existing.eventType !== ADMIN_INVITATION_OPERATION_EVENT_TYPE) {
        throw new Error('Operation ID is already used by another request')
      }
      const requested = {
        ...payload.request,
        organizationId: input.organizationId,
        emails,
        workspaceIds,
        role: input.role,
        permission: input.permission,
        actor: input.actor,
      }
      if (!sameRequest(payload.request, requested)) {
        throw new Error('Operation ID was already used with different invitation parameters')
      }
      if (existing.status === 'dead_letter') {
        const [requeued] = await tx
          .update(outboxEvent)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            availableAt: new Date(),
            lockedAt: null,
            processedAt: null,
          })
          .where(eq(outboxEvent.id, input.operationId))
          .returning()
        if (!requeued) throw new Error('Invitation operation could not be requeued')
        return requeued
      }
      return existing
    }

    const [owner] = await tx
      .select({ id: user.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, input.organizationId), eq(member.role, 'owner')))
      .limit(1)
    if (!owner) throw new Error('Organization owner not found')
    const selected = await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(eq(workspace.organizationId, input.organizationId), inArray(workspace.id, workspaceIds))
      )
    if (selected.length !== workspaceIds.length) {
      throw new Error('Every selected workspace must belong to this organization')
    }

    const request: AdminInvitationOperationPayload['request'] = {
      organizationId: input.organizationId,
      ownerUserId: owner.id,
      emails,
      workspaceIds,
      role: input.role,
      permission: input.permission,
      actor: input.actor,
    }
    await enqueueOutboxEvent(
      tx,
      ADMIN_INVITATION_OPERATION_EVENT_TYPE,
      { request },
      { id: input.operationId }
    )
    await enqueueOutboxEvents(
      tx,
      ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE,
      emails.map((email, sequence) => ({
        source: 'admin' as const,
        provisioningOperationId: input.operationId,
        organizationId: input.organizationId,
        ownerUserId: owner.id,
        email,
        role: input.role,
        permission: input.permission,
        sequence,
      }))
    )
    const [created] = await tx
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, input.operationId))
      .limit(1)
    if (!created) throw new Error('Invitation operation was not created')
    return created
  })

  return buildAdminInvitationOperationView(row)
}

export async function getAdminInvitationOperation(
  organizationId: string,
  operationId: string
): Promise<AdminInvitationOperationView> {
  const [row] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ADMIN_INVITATION_OPERATION_EVENT_TYPE),
        sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
      )
    )
    .limit(1)
  if (!row) throw new Error('Invitation operation not found')
  return buildAdminInvitationOperationView(row)
}

export async function retryAdminInvitationOperationJob(
  organizationId: string,
  operationId: string,
  jobId: string
): Promise<AdminInvitationOperationView> {
  await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [operation] = await tx
      .select({ payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.id, operationId),
          eq(outboxEvent.eventType, ADMIN_INVITATION_OPERATION_EVENT_TYPE)
        )
      )
      .limit(1)
    const parent = parseAdminInvitationOperationPayload(operation?.payload)
    if (!parent || parent.request.organizationId !== organizationId) {
      throw new Error('Invitation operation not found')
    }
    const [job] = await tx
      .select({
        eventType: outboxEvent.eventType,
        status: outboxEvent.status,
        payload: outboxEvent.payload,
      })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, jobId))
      .for('update')
      .limit(1)
    const operationKey =
      job?.eventType === ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE
        ? (job.payload as { provisioningOperationId?: unknown }).provisioningOperationId
        : (job?.payload as { sourceOperationId?: unknown } | undefined)?.sourceOperationId
    if (
      !job ||
      ![ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE, DIRECT_GRANT_EMAIL_EVENT_TYPE].includes(
        job.eventType
      ) ||
      operationKey !== operationId
    ) {
      throw new Error('Invitation operation job not found')
    }
    if (job.status !== 'dead_letter') return
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
      .where(eq(outboxEvent.id, jobId))
  })
  return getAdminInvitationOperation(organizationId, operationId)
}

const processAdminInvitationOperation: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = parseAdminInvitationOperationPayload(rawPayload)
  if (!payload) throw new Error('Invalid Admin invitation-operation payload')
  await recordAuditOnce(`${context.eventId}:requested`, {
    actorId: payload.request.actor.id,
    actorName: payload.request.actor.name,
    actorEmail: payload.request.actor.email,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: payload.request.organizationId,
    description: 'Admin requested a durable organization invitation batch',
    metadata: {
      invitationOperationId: context.eventId,
      recipientCount: payload.request.emails.length,
      workspaceCount: payload.request.workspaceIds.length,
      role: payload.request.role,
      permission: payload.request.permission,
    },
  })
  const operationIdExpression = sql<string>`${outboxEvent.payload} ->> 'provisioningOperationId'`
  const [invitationTotals] = await db
    .select({
      selected: count(),
      active:
        sql<number>`count(*) filter (where ${outboxEvent.status} in ('pending', 'processing'))`.mapWith(
          Number
        ),
    })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE),
        eq(operationIdExpression, context.eventId)
      )
    )
  if ((invitationTotals?.selected ?? 0) !== payload.request.emails.length) {
    throw new Error('Invitation operation child set is incomplete')
  }
  if ((invitationTotals?.active ?? 0) > 0) {
    return deferOutboxHandler('Waiting for invitation recipients', undefined, false)
  }

  const notificationOperationIdExpression = sql<string>`${outboxEvent.payload} ->> 'sourceOperationId'`
  const [notificationTotals] = await db
    .select({
      active:
        sql<number>`count(*) filter (where ${outboxEvent.status} in ('pending', 'processing'))`.mapWith(
          Number
        ),
    })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, DIRECT_GRANT_EMAIL_EVENT_TYPE),
        eq(notificationOperationIdExpression, context.eventId)
      )
    )
  if ((notificationTotals?.active ?? 0) > 0) {
    return deferOutboxHandler('Waiting for direct-grant notifications', undefined, false)
  }
}

export const adminInvitationOperationOutboxHandlers = {
  [ADMIN_INVITATION_OPERATION_EVENT_TYPE]: processAdminInvitationOperation,
} as const
