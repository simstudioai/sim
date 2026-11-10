import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { z } from 'zod'
import { enqueueOutboxEvent, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import { PERSONAL_ORGANIZATION_AUDIT_EVENT } from '@/lib/organizations/lifecycle-audit-event'

const actorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), userId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('system'), name: z.string().min(1) }).strict(),
])

/**
 * Who made the change: a signed-in user (the person themselves, an inviter's invitee accepting, an
 * organization or platform admin) or a system actor with no user row (the Admin API key, SCIM, the
 * billing webhook, an operator script). Never the person whose organization changed, unless they
 * made the change themselves.
 */
export type PersonalOrganizationAuditActor = z.output<typeof actorSchema>

const personalOrganizationAuditSchema = z
  .object({
    change: z.enum(['created', 'converted', 'retired', 'reverted', 'deleted']),
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    /** Absent only on events queued before the actor was carried. */
    actor: actorSchema.optional(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict()

type PersonalOrganizationAudit = z.output<typeof personalOrganizationAuditSchema> & {
  actor: PersonalOrganizationAuditActor
}

const AUDIT_ENTRY = {
  created: {
    action: AuditAction.ORGANIZATION_CREATED,
    description: 'Personal organization created',
  },
  converted: {
    action: AuditAction.ORGANIZATION_UPDATED,
    description: 'Personal organization converted into a team',
  },
  retired: {
    action: AuditAction.ORGANIZATION_DELETED,
    description: 'Personal organization retired on joining another organization',
  },
  reverted: {
    action: AuditAction.ORGANIZATION_DELETED,
    description: 'Personal organization removed by the personal organization rollback',
  },
  deleted: {
    action: AuditAction.ORGANIZATION_DELETED,
    description: 'Personal organization deleted with its owner’s account',
  },
} as const

/**
 * Records a personal organization's creation, conversion into a team, retirement, rollback or
 * deletion with its owner's account once the
 * caller's transaction commits: the entry is queued in that transaction, so a rollback records
 * nothing, and written by the outbox worker after commit, keyed by the event so a retry writes it
 * once. Every lifecycle change happens inside a membership transaction its many callers own, which
 * is why the entry rides the outbox instead of each caller recording it after its own commit.
 */
export async function enqueuePersonalOrganizationAuditTx(
  tx: DbTransaction,
  audit: PersonalOrganizationAudit
): Promise<void> {
  await enqueueOutboxEvent(
    tx,
    PERSONAL_ORGANIZATION_AUDIT_EVENT,
    personalOrganizationAuditSchema.parse(audit)
  )
}

export const personalOrganizationAuditOutboxHandlers = {
  [PERSONAL_ORGANIZATION_AUDIT_EVENT]: async (rawPayload, context) => {
    const { change, organizationId, userId, actor, metadata } =
      personalOrganizationAuditSchema.parse(rawPayload)
    await recordAuditOnce(context.eventId, {
      ...(actor?.type === 'user'
        ? { actorId: actor.userId }
        : { actorId: null, actorName: actor?.name ?? 'System' }),
      action: AUDIT_ENTRY[change].action,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      description: AUDIT_ENTRY[change].description,
      metadata: {
        ...metadata,
        organizationId,
        userId,
        kind: change === 'converted' ? 'team' : 'personal',
      },
    })
  },
} satisfies OutboxHandlerRegistry
