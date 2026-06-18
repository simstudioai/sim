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
import { cancelPendingInvitation, sendWorkspaceAddedEmail } from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InvitationDirectGrant')

export type DirectGrantOutcome =
  | { outcome: 'added'; permission: PermissionType }
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
 * organization and are not yet members of the workspace. Idempotent: when a
 * permission already exists it is left untouched (no-op) — invites never modify
 * or upgrade an existing member's permission.
 */
export async function grantWorkspaceAccessDirectly(
  input: GrantWorkspaceAccessDirectlyInput
): Promise<DirectGrantOutcome> {
  const normalizedEmail = normalizeEmail(input.email)

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

    if (existing) {
      return { outcome: 'unchanged', permission: existing.permissionType as PermissionType }
    }

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

    if (inserted.length === 0) {
      return { outcome: 'unchanged', permission: input.permission }
    }

    return { outcome: 'added', permission: input.permission }
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
    description: `Added existing organization member ${normalizedEmail} as ${input.permission}`,
    metadata: {
      targetEmail: normalizedEmail,
      targetRole: input.permission,
      organizationId: input.organizationId,
      workspaceName: input.workspaceName,
      addedUserId: input.userId,
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
