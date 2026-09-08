import { AuditAction, AuditResourceType, recordAudit, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  permissions,
  workspaceEnvironment,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  acquireOrganizationUserMutationLocks,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import { enqueueOutboxEvent, type OutboxHandler } from '@/lib/core/outbox/service'
import { PlatformEvents } from '@/lib/core/telemetry'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import type { DbOrTx } from '@/lib/db/types'
import { revokeInvitationWorkspaceGrantTx } from '@/lib/invitations/core'
import {
  DIRECT_GRANT_EMAIL_EVENT_TYPE,
  type DirectGrantEmailPayload,
} from '@/lib/invitations/direct-grant-event'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { sendWorkspaceAddedEmail } from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getEffectiveWorkspacePermission,
  getWorkspaceWithOwner,
  type PermissionType,
} from '@/lib/workspaces/permissions/utils'
import { assertMembershipNotScimManaged } from '@/ee/scim/lib/managed-membership'

const logger = createLogger('InvitationDirectGrant')

export type DirectGrantOutcome =
  | { outcome: 'added'; permission: PermissionType }
  | { outcome: 'updated'; permission: PermissionType; previousPermission: PermissionType }
  | { outcome: 'unchanged'; permission: PermissionType }

export class DirectGrantContextChangedError extends Error {
  constructor() {
    super('Workspace or organization membership changed before access could be granted')
    this.name = 'DirectGrantContextChangedError'
  }
}

class DirectGrantInvitationSetChangedError extends Error {
  constructor(readonly invitationIds: string[]) {
    super('Pending invitation set changed while granting workspace access')
    this.name = 'DirectGrantInvitationSetChangedError'
  }
}

export interface GrantWorkspaceAccessDirectlyInput {
  /** Registered user receiving access. */
  userId: string
  /** Invitee email (used for notification + audit; normalized internally). */
  email: string
  workspaceId: string
  workspaceName: string
  permission: PermissionType
  /** Organization that owns the workspace. */
  organizationId: string
  actorId: string
  actorName: string
  actorEmail?: string | null
  /** Audit attribution may differ from the authorized product actor for admin tooling. */
  auditActor?: { id: string | null; name: string; email: string | null }
  request?: NextRequest
  /** Send the lightweight "you've been added" email. Defaults to true. */
  notify?: boolean
  /** Ordinary invites preserve access; provisioning may explicitly ensure the requested minimum. */
  existingPermissionPolicy?: 'preserve' | 'ensure-at-least'
  /** Correlates durable notification delivery with a parent Admin operation. */
  sourceOperationId?: string
  /** Makes the semantic audit recoverable when the caller itself is durable. */
  auditOperationId?: string
}

async function getPendingWorkspaceInvitationIds(
  executor: DbOrTx,
  workspaceId: string,
  normalizedEmail: string
): Promise<string[]> {
  const rows = await executor
    .select({ invitationId: invitation.id })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(
        sql`lower(${invitation.email}) = ${normalizedEmail}`,
        eq(invitation.status, 'pending'),
        eq(invitationWorkspaceGrant.workspaceId, workspaceId)
      )
    )
  return [...new Set(rows.map((row) => row.invitationId))].sort()
}

/**
 * Grants a user workspace access immediately, without an invitation or
 * acceptance step. Intended for users who already belong to the workspace's
 * organization and are not yet members of the workspace. Idempotent by default:
 * existing permissions are preserved. Trusted provisioning/Admin operations may
 * explicitly ensure a minimum permission without ever downgrading stronger access.
 */
export async function grantWorkspaceAccessDirectly(
  input: GrantWorkspaceAccessDirectlyInput
): Promise<DirectGrantOutcome> {
  const normalizedEmail = normalizeEmail(input.email)
  let candidateInvitationIds = await getPendingWorkspaceInvitationIds(
    db,
    input.workspaceId,
    normalizedEmail
  )
  let result: DirectGrantOutcome | undefined

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      result = await db.transaction(async (tx): Promise<DirectGrantOutcome> => {
        /**
         * Match acceptance/admin-move/removal ordering: invitation + workspace
         * advisory locks first, then organization → user → membership locks.
         * Every authorization read below is transaction-local and happens only
         * after that shared fence.
         */
        await acquireInvitationMutationLocks(tx, {
          invitationIds: candidateInvitationIds,
          workspaceIds: [input.workspaceId],
        })
        await acquireOrganizationUserMutationLocks(tx, {
          userId: input.userId,
          organizationIds: [input.organizationId],
        })
        /** A member the directory manages gets workspace access from the directory, not by hand. */
        await assertMembershipNotScimManaged({
          organizationId: input.organizationId,
          userId: input.userId,
          executor: tx,
        })

        const currentInvitationIds = await getPendingWorkspaceInvitationIds(
          tx,
          input.workspaceId,
          normalizedEmail
        )
        const candidateSet = new Set(candidateInvitationIds)
        if (currentInvitationIds.some((id) => !candidateSet.has(id))) {
          throw new DirectGrantInvitationSetChangedError(currentInvitationIds)
        }

        // Effective admin access may be inherited. Lock the exact actor member
        // row so a concurrent direct role demotion cannot commit after this
        // authorization check and before the permission insert.
        await tx
          .select({ id: member.id, role: member.role })
          .from(member)
          .where(
            and(eq(member.userId, input.actorId), eq(member.organizationId, input.organizationId))
          )
          .for('update')

        const workspaceRow = await getWorkspaceWithOwner(input.workspaceId, {
          executor: tx,
          forUpdate: true,
        })
        if (!workspaceRow || workspaceRow.organizationId !== input.organizationId) {
          throw new DirectGrantContextChangedError()
        }

        const inviteeMembership = await getUserOrganization(input.userId, tx)
        await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, input.workspaceId),
              eq(permissions.userId, input.actorId)
            )
          )
          .for('update')
        const actorPermission = await getEffectiveWorkspacePermission(
          input.actorId,
          workspaceRow,
          tx
        )
        if (
          inviteeMembership?.organizationId !== input.organizationId ||
          actorPermission !== 'admin'
        ) {
          throw new DirectGrantContextChangedError()
        }

        const [existing] = await tx
          .select({ id: permissions.id, permissionType: permissions.permissionType })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityId, input.workspaceId),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.userId, input.userId)
            )
          )
          .for('update')
          .limit(1)

        let outcome: DirectGrantOutcome
        if (existing) {
          const existingPermission = existing.permissionType as PermissionType
          if (
            input.existingPermissionPolicy === 'ensure-at-least' &&
            !permissionSatisfies(existingPermission, input.permission)
          ) {
            await tx
              .update(permissions)
              .set({ permissionType: input.permission, updatedAt: new Date() })
              .where(eq(permissions.id, existing.id))
            outcome = {
              outcome: 'updated',
              permission: input.permission,
              previousPermission: existingPermission,
            }
          } else {
            outcome = { outcome: 'unchanged', permission: existingPermission }
          }
        } else {
          const inserted = await tx
            .insert(permissions)
            .values({
              id: generateId(),
              entityType: 'workspace',
              entityId: input.workspaceId,
              userId: input.userId,
              permissionType: input.permission,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: permissions.id })

          outcome =
            inserted.length === 0
              ? { outcome: 'unchanged', permission: input.permission }
              : { outcome: 'added', permission: input.permission }
        }

        if (currentInvitationIds.length > 0) {
          for (const invitationId of currentInvitationIds) {
            await revokeInvitationWorkspaceGrantTx(tx, {
              invitationId,
              workspaceId: input.workspaceId,
            })
          }
        }

        if (outcome.outcome === 'added' && (input.notify ?? true)) {
          await enqueueOutboxEvent(tx, DIRECT_GRANT_EMAIL_EVENT_TYPE, {
            email: normalizedEmail,
            inviterName: input.actorName,
            workspaceId: input.workspaceId,
            workspaceName: input.workspaceName,
            ...(input.sourceOperationId ? { sourceOperationId: input.sourceOperationId } : {}),
          })
        }

        return outcome
      })
      break
    } catch (error) {
      if (error instanceof DirectGrantInvitationSetChangedError) {
        candidateInvitationIds = error.invitationIds
        continue
      }
      throw error
    }
  }

  if (!result) {
    throw new Error('Pending invitations kept changing while granting workspace access')
  }
  if (result.outcome === 'unchanged') return result

  if (result.outcome === 'added') {
    try {
      const [wsEnvRow] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, input.workspaceId))
        .limit(1)
      const wsEnvKeys = Object.keys((wsEnvRow?.variables as Record<string, string>) || {})
      if (wsEnvKeys.length > 0) {
        await syncWorkspaceEnvCredentials({
          workspaceId: input.workspaceId,
          envKeys: wsEnvKeys,
          actingUserId: input.userId,
        })
      }
    } catch (error) {
      logger.error('Failed to sync workspace env credentials after direct grant', {
        workspaceId: input.workspaceId,
        userId: input.userId,
        error,
      })
    }
  }

  try {
    if (result.outcome === 'added') {
      PlatformEvents.workspaceMemberAdded({
        workspaceId: input.workspaceId,
        addedBy: input.actorId,
        addedUserId: input.userId,
        role: input.permission,
      })
    }
  } catch {
    /**
     * Telemetry must not fail the grant.
     */
  }

  captureServerEvent(
    input.actorId,
    result.outcome === 'updated' ? 'workspace_member_role_changed' : 'workspace_member_added',
    {
      workspace_id: input.workspaceId,
      ...(result.outcome === 'updated'
        ? { new_role: result.permission }
        : { member_role: input.permission }),
    },
    { groups: { workspace: input.workspaceId } }
  )

  const audit = {
    workspaceId: input.workspaceId,
    actorId: input.auditActor ? input.auditActor.id : input.actorId,
    actorName: input.auditActor ? input.auditActor.name : input.actorName,
    actorEmail: input.auditActor ? input.auditActor.email : input.actorEmail,
    action:
      result.outcome === 'updated' ? AuditAction.MEMBER_ROLE_CHANGED : AuditAction.MEMBER_ADDED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: input.workspaceId,
    resourceName: normalizedEmail,
    description:
      result.outcome === 'updated'
        ? `Changed ${normalizedEmail} from ${result.previousPermission} to ${result.permission}`
        : `Added existing organization member ${normalizedEmail} as ${input.permission}`,
    metadata: {
      targetEmail: normalizedEmail,
      targetRole: input.permission,
      organizationId: input.organizationId,
      workspaceName: input.workspaceName,
      addedUserId: input.userId,
    },
    request: input.request,
  } as const
  if (input.auditOperationId) {
    await recordAuditOnce(
      `${input.auditOperationId}:workspace-access:${input.workspaceId}:${input.userId}`,
      audit
    )
  } else {
    recordAudit(audit)
  }

  return result
}

const sendDirectGrantEmail: OutboxHandler = async (rawPayload) => {
  if (
    !isRecordLike(rawPayload) ||
    typeof rawPayload.email !== 'string' ||
    typeof rawPayload.inviterName !== 'string' ||
    typeof rawPayload.workspaceId !== 'string' ||
    typeof rawPayload.workspaceName !== 'string'
  ) {
    throw new Error('Invalid workspace-added email payload')
  }
  const payload: DirectGrantEmailPayload = {
    email: rawPayload.email,
    inviterName: rawPayload.inviterName,
    workspaceId: rawPayload.workspaceId,
    workspaceName: rawPayload.workspaceName,
  }
  const result = await sendWorkspaceAddedEmail({
    email: payload.email,
    inviterName: payload.inviterName,
    workspaceId: payload.workspaceId,
    workspaceName: payload.workspaceName,
  })
  if (!result.success) {
    throw new Error(result.error || 'Failed to send workspace-added email')
  }
}

export const directGrantOutboxHandlers = {
  [DIRECT_GRANT_EMAIL_EVENT_TYPE]: sendDirectGrantEmail,
} as const
