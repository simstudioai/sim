import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { credential, credentialMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  upsertWorkspaceCredentialMemberContract,
  type WorkspaceCredentialMember,
} from '@/lib/api/contracts/credentials'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deriveCredentialAdmin, isSharedCredentialType } from '@/lib/credentials/access'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getUserEntityPermissions,
  getUsersWithPermissions,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialMembersAPI')

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireCredentialAdmin(credentialId: string, userId: string) {
  const [cred] = await db
    .select({ id: credential.id, workspaceId: credential.workspaceId, type: credential.type })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!cred) return null

  const perm = await getUserEntityPermissions(userId, 'workspace', cred.workspaceId)
  if (perm === null) return null

  const [membership] = await db
    .select({ role: credentialMember.role, status: credentialMember.status })
    .from(credentialMember)
    .where(
      and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, userId))
    )
    .limit(1)

  const isAdmin = deriveCredentialAdmin({
    credentialType: cred.type,
    memberRole: membership?.status === 'active' ? membership.role : null,
    workspaceCanAdmin: perm === 'admin',
  })

  if (!isAdmin) {
    return null
  }
  return { credentialType: cred.type, workspaceId: cred.workspaceId }
}

export const GET = withRouteHandler(async (_request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params

    const [cred] = await db
      .select({ id: credential.id, workspaceId: credential.workspaceId, type: credential.type })
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)

    if (!cred) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const callerPerm = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      cred.workspaceId
    )
    if (callerPerm === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const explicitMembers = await db
      .select({
        id: credentialMember.id,
        userId: credentialMember.userId,
        role: credentialMember.role,
        status: credentialMember.status,
        joinedAt: credentialMember.joinedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(credentialMember)
      .innerJoin(user, eq(credentialMember.userId, user.id))
      .where(eq(credentialMember.credentialId, credentialId))

    const byUser = new Map<string, WorkspaceCredentialMember>(
      explicitMembers.map((m) => [
        m.userId,
        {
          id: m.id,
          userId: m.userId,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
          userName: m.userName,
          userEmail: m.userEmail,
          roleSource: 'explicit' as const,
        },
      ])
    )

    if (isSharedCredentialType(cred.type)) {
      const workspaceMembers = await getUsersWithPermissions(cred.workspaceId)
      for (const wsMember of workspaceMembers) {
        if (wsMember.permissionType !== 'admin') continue
        const existing = byUser.get(wsMember.userId)
        if (existing) {
          existing.role = 'admin'
          existing.status = 'active'
          existing.roleSource = 'workspace-admin'
        } else {
          byUser.set(wsMember.userId, {
            id: `workspace-admin-${wsMember.userId}`,
            userId: wsMember.userId,
            role: 'admin',
            status: 'active',
            joinedAt: null,
            userName: wsMember.name,
            userEmail: wsMember.email,
            roleSource: 'workspace-admin',
          })
        }
      }
    }

    const members = Array.from(byUser.values())

    return NextResponse.json({ members })
  } catch (error) {
    logger.error('Failed to fetch credential members', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params

    const admin = await requireCredentialAdmin(credentialId, session.user.id)
    if (!admin) {
      logger.warn('Credential member share denied', {
        credentialId,
        actorId: session.user.id,
        reason: 'not-admin',
      })
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    if (!isSharedCredentialType(admin.credentialType)) {
      logger.warn('Credential member share denied', {
        credentialId,
        actorId: session.user.id,
        reason: 'env_personal-cannot-be-shared',
      })
      return NextResponse.json({ error: 'Personal secrets cannot be shared' }, { status: 400 })
    }

    const parsed = await parseRequest(upsertWorkspaceCredentialMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { userId, role } = parsed.data.body

    const targetWorkspacePerm = await getUserEntityPermissions(
      userId,
      'workspace',
      admin.workspaceId
    )
    if (targetWorkspacePerm === 'admin' && role !== 'admin') {
      return NextResponse.json(
        { error: 'Workspace admins are automatically credential admins and cannot be demoted' },
        { status: 400 }
      )
    }

    const now = new Date()

    const [existing] = await db
      .select({ id: credentialMember.id, status: credentialMember.status })
      .from(credentialMember)
      .where(
        and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, userId))
      )
      .limit(1)

    if (existing) {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ role: credentialMember.role, status: credentialMember.status })
          .from(credentialMember)
          .where(eq(credentialMember.id, existing.id))
          .limit(1)
          .for('update')
        if (
          !isSharedCredentialType(admin.credentialType) &&
          current?.role === 'admin' &&
          current?.status === 'active' &&
          role !== 'admin'
        ) {
          const activeAdmins = await tx
            .select({ id: credentialMember.id })
            .from(credentialMember)
            .where(
              and(
                eq(credentialMember.credentialId, credentialId),
                eq(credentialMember.role, 'admin'),
                eq(credentialMember.status, 'active')
              )
            )
            .for('update')
          if (activeAdmins.length <= 1) return { ok: false as const }
        }
        await tx
          .update(credentialMember)
          .set({ role, status: 'active', updatedAt: now })
          .where(eq(credentialMember.id, existing.id))
        return { ok: true as const, fromRole: current?.role }
      })
      if (!result.ok) {
        return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
      }

      recordAudit({
        workspaceId: admin.workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.CREDENTIAL_MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.CREDENTIAL,
        resourceId: credentialId,
        description: `Changed credential member role to "${role}"`,
        metadata: { targetUserId: userId, fromRole: result.fromRole, toRole: role },
        request,
      })

      return NextResponse.json({ success: true })
    }

    await db.insert(credentialMember).values({
      id: generateId(),
      credentialId,
      userId,
      role,
      status: 'active',
      joinedAt: now,
      invitedBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    })

    captureServerEvent(session.user.id, 'credential_shared', {
      credential_type: admin.credentialType,
      role,
      workspace_id: admin.workspaceId,
    })

    recordAudit({
      workspaceId: admin.workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CREDENTIAL_MEMBER_ADDED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credentialId,
      description: `Shared credential with member as "${role}"`,
      metadata: { targetUserId: userId, role },
      request,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    logger.error('Failed to add credential member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params
    const targetUserId = new URL(request.url).searchParams.get('userId')
    if (!targetUserId) {
      return NextResponse.json({ error: 'userId query parameter required' }, { status: 400 })
    }

    const admin = await requireCredentialAdmin(credentialId, session.user.id)
    if (!admin) {
      logger.warn('Credential member removal denied', {
        credentialId,
        actorId: session.user.id,
        reason: 'not-admin',
      })
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const [target] = await db
      .select({
        id: credentialMember.id,
        role: credentialMember.role,
      })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, credentialId),
          eq(credentialMember.userId, targetUserId),
          eq(credentialMember.status, 'active')
        )
      )
      .limit(1)

    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (isSharedCredentialType(admin.credentialType)) {
      const targetWorkspacePerm = await getUserEntityPermissions(
        targetUserId,
        'workspace',
        admin.workspaceId
      )
      if (targetWorkspacePerm === 'admin') {
        return NextResponse.json(
          { error: 'Workspace admins are automatically credential admins and cannot be removed' },
          { status: 400 }
        )
      }
    }

    const revoked = await db.transaction(async (tx) => {
      if (!isSharedCredentialType(admin.credentialType) && target.role === 'admin') {
        const activeAdmins = await tx
          .select({ id: credentialMember.id })
          .from(credentialMember)
          .where(
            and(
              eq(credentialMember.credentialId, credentialId),
              eq(credentialMember.role, 'admin'),
              eq(credentialMember.status, 'active')
            )
          )
          .for('update')

        if (activeAdmins.length <= 1) {
          return false
        }
      }

      await tx
        .update(credentialMember)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(eq(credentialMember.id, target.id))

      return true
    })

    if (!revoked) {
      return NextResponse.json({ error: 'Cannot remove the last admin' }, { status: 400 })
    }

    captureServerEvent(session.user.id, 'credential_unshared', {
      credential_type: admin.credentialType,
      workspace_id: admin.workspaceId,
    })

    recordAudit({
      workspaceId: admin.workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CREDENTIAL_MEMBER_REMOVED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credentialId,
      description: 'Removed credential member',
      metadata: { targetUserId },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to remove credential member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
