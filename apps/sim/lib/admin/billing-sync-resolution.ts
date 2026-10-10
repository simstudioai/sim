import { AuditAction, type AuditLogParams, AuditResourceType, recordAudit } from '@sim/audit'
import type { AdminV1ResolveOutboxEventBody } from '@/lib/api/contracts/v1/admin'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import { resolveDeadLetteredOutboxEvent } from '@/lib/core/outbox/service'

/**
 * Billing Stripe events only: their readers tell a resolved row from delivered work (the admin
 * dashboard reports a completed cancellation with a `lastError` as `resolved`). Other domains
 * count every `completed` row as delivered and retry through their own admin actions.
 */
const RESOLVABLE_EVENT_TYPES = Object.values(OUTBOX_EVENT_TYPES)

/**
 * Closes a dead-lettered billing Stripe event for the Admin API and audits who resolved it and
 * why. Null when the event does not exist, is not dead-lettered, or is not a billing Stripe event.
 */
export async function resolveBillingSyncDeadLetter(
  eventId: string,
  resolution: AdminV1ResolveOutboxEventBody,
  request: AuditLogParams['request']
) {
  const resolved = await resolveDeadLetteredOutboxEvent(eventId, RESOLVABLE_EVENT_TYPES, resolution)
  if (!resolved) return null
  recordAudit({
    workspaceId: null,
    actorId: null,
    actorName: `Admin API (${resolution.resolvedBy})`,
    action: AuditAction.BILLING_SYNC_RESOLVED,
    resourceType: AuditResourceType.BILLING,
    resourceId: resolved.id,
    description: `Admin API resolved a dead-lettered ${resolved.eventType} event`,
    metadata: { eventType: resolved.eventType, ...resolution },
    request,
  })
  return resolved
}
