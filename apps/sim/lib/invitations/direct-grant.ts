import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  permissions,
  workspaceEnvironment,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { PlatformEvents } from '@/lib/core/telemetry'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { PERMISSION_RANK, type PermissionLevel } from '@/lib/invitations/core'
import { cancelPendingInvitation, sendWorkspaceAddedEmail } from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InvitationDirectGrant')

export type DirectGrantOutcome =
  | { outcome: 'added'; permission: PermissionType }
  | { outcome: 'upgraded'; from: PermissionType; to: PermissionType }
  | { outcome: 'unchanged'; permission: PermissionType }

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
  request?: NextRequest
  /** Send the lightweight "you've been added" email. Defaults to true. */
  notify?: boolean
}

/**
 * Returns whether the given user is already a member of the workspace's
 * organization. Only same-org members are eligible for direct (no-acceptance)
 * workspace access.
 */
export async function isSameOrgMember(
  userId: string,
  workspaceOrganizationId: string | null
): Promise<boolean> {
  if (!workspaceOrganizationId) return false
  const membership = await getUserOrganization(userId)
  return !!membership && membership.organizationId === workspaceOrganizationId
}

/**
 * Cancels any pending single-workspace invitations that grant exactly this
 * workspace to this email. Multi-workspace organization invitations are left
 * untouched — their remaining grants stay valid and the accept flow upserts
 * permissions idempotently.
 */
async function supersedePendingWorkspaceInvites(
  workspaceId: string,
  normalizedEmail: string
): Promise<void> {
  const rows = await db
    .select({ invitationId: invitation.id })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(
        eq(invitation.kind, 'workspace'),
        eq(invitation.email, normalizedEmail),
        eq(invitation.status, 'pending'),
        eq(invitationWorkspaceGrant.workspaceId, workspaceId)
      )
    )

  for (const row of rows) {
    await cancelPendingInvitation(row.invitationId)
  }
}

/**
 * Grants a user workspace access immediately, without an invitation or
 * acceptance step. Intended for users who already belong to the workspace's
 * organization. Idempotent: no-ops when the user already has equal or higher
 * access, upgrades when the new permission is higher.
 */
export async function grantWorkspaceAccessDirectly(
  input: GrantWorkspaceAccessDirectlyInput
): Promise<DirectGrantOutcome> {
  const normalizedEmail = normalizeEmail(input.email)
  const newPermission = input.permission as PermissionLevel
  const newRank = PERMISSION_RANK[newPermission] ?? 0

  const result = await db.transaction(async (tx): Promise<DirectGrantOutcome> => {
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
      .limit(1)

    if (!existing) {
      await tx
        .insert(permissions)
        .values({
          id: generateId(),
          entityType: 'workspace',
          entityId: input.workspaceId,
          userId: input.userId,
          permissionType: newPermission,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
      return { outcome: 'added', permission: input.permission }
    }

    const existingPermission = existing.permissionType as PermissionType
    const existingRank = PERMISSION_RANK[existingPermission as PermissionLevel] ?? 0
    if (newRank > existingRank) {
      await tx
        .update(permissions)
        .set({ permissionType: newPermission, updatedAt: new Date() })
        .where(eq(permissions.id, existing.id))
      return { outcome: 'upgraded', from: existingPermission, to: input.permission }
    }

    return { outcome: 'unchanged', permission: existingPermission }
  })

  if (result.outcome === 'unchanged') {
    return result
  }

  try {
    await supersedePendingWorkspaceInvites(input.workspaceId, normalizedEmail)
  } catch (error) {
    logger.error('Failed to supersede pending workspace invitations after direct grant', {
      workspaceId: input.workspaceId,
      error,
    })
  }

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

  try {
    PlatformEvents.workspaceMemberAdded({
      workspaceId: input.workspaceId,
      addedBy: input.actorId,
      addedUserId: input.userId,
      role: input.permission,
      outcome: result.outcome,
    })
  } catch {
    /**
     * Telemetry must not fail the grant.
     */
  }

  captureServerEvent(
    input.actorId,
    'workspace_member_added',
    {
      workspace_id: input.workspaceId,
      member_role: input.permission,
      outcome: result.outcome,
    },
    {
      groups: { workspace: input.workspaceId },
    }
  )

  recordAudit({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    actorName: input.actorName,
    actorEmail: input.actorEmail,
    action: AuditAction.MEMBER_ADDED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: input.workspaceId,
    resourceName: normalizedEmail,
    description:
      result.outcome === 'upgraded'
        ? `Added existing organization member ${normalizedEmail} (upgraded to ${input.permission})`
        : `Added existing organization member ${normalizedEmail} as ${input.permission}`,
    metadata: {
      targetEmail: normalizedEmail,
      targetRole: input.permission,
      organizationId: input.organizationId,
      workspaceName: input.workspaceName,
      addedUserId: input.userId,
      outcome: result.outcome,
    },
    request: input.request,
  })

  if (input.notify ?? true) {
    try {
      await sendWorkspaceAddedEmail({
        email: normalizedEmail,
        inviterName: input.actorName,
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
      })
    } catch (error) {
      logger.error('Failed to send workspace added email', {
        workspaceId: input.workspaceId,
        email: normalizedEmail,
        error,
      })
    }
  }

  return result
}
