import { db } from '@sim/db'
import { member, outboxEvent, permissionAccessRequest, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { renderPermissionAccessRequestEmail } from '@/components/emails/render'
import { getEmailSubject } from '@/components/emails/subjects'
import { isAccountBlocked } from '@/lib/auth/ban'
import {
  continueOutboxHandler,
  type OutboxEventContext,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { hasEmailService, sendEmail } from '@/lib/messaging/email/mailer'
import { loadAccessRequestMembership } from '@/ee/access-requests/lib/application/authorization'
import { getMyAccessRequestHref } from '@/ee/access-requests/lib/navigation'
import {
  PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
  PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
} from '@/ee/access-requests/lib/notification-events'
import { isAccessRequestEnabled } from '@/ee/access-requests/lib/settings'

const logger = createLogger('PermissionAccessRequestNotifications')
const ADMIN_RECIPIENT_PAGE_SIZE = 50
const ADMIN_NOTIFICATION_EVENT = 'permission-access-request.notify-admin'
const notificationPayloadSchema = z.object({ requestId: z.string().min(1).max(256) }).strict()
const createdPayloadSchema = notificationPayloadSchema.extend({
  afterMemberId: z.string().min(1).max(256).optional(),
})
const adminPayloadSchema = notificationPayloadSchema.extend({
  recipientUserId: z.string().min(1).max(256),
})

async function loadRequest(requestId: string) {
  const [request] = await db
    .select({
      id: permissionAccessRequest.id,
      organizationId: permissionAccessRequest.organizationId,
      requesterId: permissionAccessRequest.requesterId,
      workspaceId: permissionAccessRequest.workspaceId,
      status: permissionAccessRequest.status,
      membershipId: permissionAccessRequest.membershipId,
    })
    .from(permissionAccessRequest)
    .where(eq(permissionAccessRequest.id, requestId))
    .limit(1)
  return request ?? null
}

type NotificationRequest = NonNullable<Awaited<ReturnType<typeof loadRequest>>>

async function requesterHasCurrentAccess(request: NotificationRequest): Promise<boolean> {
  if (request.workspaceId) {
    const [scope] = await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(and(eq(workspace.id, request.workspaceId), isNull(workspace.archivedAt)))
      .limit(1)
    if (!scope || scope.organizationId !== request.organizationId) return false
  }
  const membership = await loadAccessRequestMembership(
    db,
    request.requesterId,
    request.workspaceId
      ? { kind: 'workspace', workspaceId: request.workspaceId }
      : { kind: 'organization', organizationId: request.organizationId },
    request.organizationId
  )
  return membership?.membershipId === request.membershipId
}

function requestLink(request: NotificationRequest, kind: 'created' | 'decided'): string {
  if (kind === 'decided') {
    return new URL(
      getMyAccessRequestHref(
        request.workspaceId
          ? { kind: 'workspace', workspaceId: request.workspaceId }
          : { kind: 'organization', organizationId: request.organizationId },
        request.id
      ),
      getBaseUrl()
    ).toString()
  }

  const url = new URL('/access-requests', getBaseUrl())
  url.searchParams.set('organizationId', request.organizationId)
  url.searchParams.set('view', 'review')
  url.searchParams.set('request-id', request.id)
  return url.toString()
}

async function deliverNotification(
  request: NotificationRequest,
  kind: 'created' | 'decided',
  recipientUserId: string,
  context: OutboxEventContext
): Promise<void> {
  const html = await renderPermissionAccessRequestEmail({
    kind,
    requestLink: requestLink(request, kind),
  })
  const recipientQuery = db
    .select({
      email: user.email,
      suspendedAt: user.suspendedAt,
      banned: user.banned,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, recipientUserId))
  const [recipient] = await recipientQuery.limit(1)
  if (!recipient || isAccountBlocked(recipient)) return
  if (kind === 'created') {
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, recipientUserId),
          eq(member.organizationId, request.organizationId),
          inArray(member.role, ['admin', 'owner'])
        )
      )
      .limit(1)
    if (!membership) return
  }
  context.signal.throwIfAborted()
  const result = await sendEmail({
    to: recipient.email,
    subject: getEmailSubject(
      kind === 'created' ? 'permission-access-request-created' : 'permission-access-request-decided'
    ),
    html,
    emailType: 'transactional',
  })
  if (!result.success) throw new Error('Failed to send access request notification')
}

/**
 * Fan-out replays insert the same child IDs; one failed recipient cannot prevent
 * other administrators receiving their messages. Provider sends remain at-least-once
 * across a crash between delivery and outbox completion.
 */
export const permissionAccessRequestOutboxHandlers = {
  [PERMISSION_ACCESS_REQUEST_CREATED_EVENT]: async (rawPayload, context) => {
    const { requestId, afterMemberId } = createdPayloadSchema.parse(rawPayload)
    const request = await loadRequest(requestId)
    if (
      !request ||
      request.status !== 'pending' ||
      !(await isAccessRequestEnabled(request.organizationId)) ||
      !(await requesterHasCurrentAccess(request))
    ) {
      return
    }
    if (!hasEmailService()) {
      logger.info('Access request email skipped because email is not configured', { requestId })
      return
    }
    const recipients = await db
      .select({ id: member.id, userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, request.organizationId),
          inArray(member.role, ['admin', 'owner']),
          afterMemberId ? gt(member.id, afterMemberId) : undefined
        )
      )
      .orderBy(asc(member.id))
      .limit(ADMIN_RECIPIENT_PAGE_SIZE)
    if (recipients.length === 0) return
    context.signal.throwIfAborted()
    await db
      .insert(outboxEvent)
      .values(
        recipients.map((recipient) => ({
          id: `${ADMIN_NOTIFICATION_EVENT}:${requestId}:${recipient.userId}`,
          eventType: ADMIN_NOTIFICATION_EVENT,
          payload: { requestId, recipientUserId: recipient.userId },
        }))
      )
      .onConflictDoNothing({ target: outboxEvent.id })
    await context.checkpointPayload({ afterMemberId: recipients[recipients.length - 1].id })
    if (recipients.length === ADMIN_RECIPIENT_PAGE_SIZE) {
      return continueOutboxHandler('Continue access request administrator notifications')
    }
  },
  [ADMIN_NOTIFICATION_EVENT]: async (rawPayload, context) => {
    const { requestId, recipientUserId } = adminPayloadSchema.parse(rawPayload)
    const request = await loadRequest(requestId)
    if (
      !request ||
      request.status !== 'pending' ||
      !hasEmailService() ||
      !(await isAccessRequestEnabled(request.organizationId)) ||
      !(await requesterHasCurrentAccess(request))
    ) {
      return
    }
    await deliverNotification(request, 'created', recipientUserId, context)
  },
  [PERMISSION_ACCESS_REQUEST_DECIDED_EVENT]: async (rawPayload, context) => {
    const { requestId } = notificationPayloadSchema.parse(rawPayload)
    const request = await loadRequest(requestId)
    if (
      !request ||
      request.status === 'pending' ||
      !hasEmailService() ||
      !(await requesterHasCurrentAccess(request))
    ) {
      return
    }
    await deliverNotification(request, 'decided', request.requesterId, context)
  },
} satisfies OutboxHandlerRegistry
