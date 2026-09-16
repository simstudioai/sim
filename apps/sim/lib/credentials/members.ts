import { db } from '@sim/db'
import { credential, credentialMember, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, notInArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isSharedCredentialType, requireOrdinaryCredentialType } from '@/lib/credentials/access'
import type { CredentialRow } from '@/lib/credentials/queries'
import {
  getUserEntityPermissions,
  getUsersWithPermissions,
} from '@/lib/workspaces/permissions/utils'

export interface CredentialMemberView {
  id: string
  userId: string
  role: 'admin' | 'member'
  status: 'active' | 'pending' | 'revoked'
  joinedAt: Date | null
  userName: string | null
  userEmail: string | null
  roleSource: 'explicit' | 'workspace-admin'
}

export async function listCredentialMembers(
  credential: CredentialRow
): Promise<CredentialMemberView[]> {
  if (!credential.workspaceId) throw new OrchestrationError('not_found', 'Credential not found')
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
    .where(eq(credentialMember.credentialId, credential.id))

  const byUser = new Map<string, CredentialMemberView>(
    explicitMembers.map((member) => [member.userId, { ...member, roleSource: 'explicit' as const }])
  )

  if (isSharedCredentialType(credential.type)) {
    const workspaceMembers = await getUsersWithPermissions(credential.workspaceId)
    for (const workspaceMember of workspaceMembers) {
      if (workspaceMember.permissionType !== 'admin') continue
      const existing = byUser.get(workspaceMember.userId)
      if (existing) {
        existing.role = 'admin'
        existing.status = 'active'
        existing.roleSource = 'workspace-admin'
      } else {
        byUser.set(workspaceMember.userId, {
          id: `workspace-admin-${workspaceMember.userId}`,
          userId: workspaceMember.userId,
          role: 'admin',
          status: 'active',
          joinedAt: null,
          userName: workspaceMember.name,
          userEmail: workspaceMember.email,
          roleSource: 'workspace-admin',
        })
      }
    }
  }

  return Array.from(byUser.values())
}

export interface UpsertCredentialMemberParams {
  credential: CredentialRow
  actorUserId: string
  targetUserId: string
  role: 'admin' | 'member'
}

export interface UpsertCredentialMemberResult {
  created: boolean
  previousRole?: 'admin' | 'member'
}

export async function upsertCredentialMember(
  params: UpsertCredentialMemberParams
): Promise<UpsertCredentialMemberResult> {
  if (!params.credential.workspaceId)
    throw new OrchestrationError('not_found', 'Credential not found')
  if (!isSharedCredentialType(params.credential.type)) {
    throw new OrchestrationError('validation', 'Personal credentials cannot be shared')
  }
  const targetWorkspacePermission = await getUserEntityPermissions(
    params.targetUserId,
    'workspace',
    params.credential.workspaceId
  )
  if (targetWorkspacePermission === null) {
    throw new OrchestrationError(
      'validation',
      'Target user must belong to the credential workspace'
    )
  }
  if (targetWorkspacePermission === 'admin' && params.role !== 'admin') {
    throw new OrchestrationError(
      'validation',
      'Workspace admins are automatically credential admins and cannot be demoted'
    )
  }

  const [existing] = await db
    .select({ id: credentialMember.id })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, params.credential.id),
        eq(credentialMember.userId, params.targetUserId)
      )
    )
    .limit(1)
  const now = new Date()
  if (existing) {
    const previousRole = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ role: credentialMember.role })
        .from(credentialMember)
        .where(eq(credentialMember.id, existing.id))
        .limit(1)
        .for('update')
      if (!current) throw new Error('Credential membership disappeared during update')
      await tx
        .update(credentialMember)
        .set({ role: params.role, status: 'active', updatedAt: now })
        .where(eq(credentialMember.id, existing.id))
      return current.role
    })
    return { created: false, previousRole }
  }

  await db.insert(credentialMember).values({
    id: generateId(),
    credentialId: params.credential.id,
    userId: params.targetUserId,
    role: params.role,
    status: 'active',
    joinedAt: now,
    invitedBy: params.actorUserId,
    createdAt: now,
    updatedAt: now,
  })
  return { created: true }
}

export async function removeCredentialMember(params: {
  credential: CredentialRow
  targetUserId: string
}): Promise<void> {
  if (!params.credential.workspaceId)
    throw new OrchestrationError('not_found', 'Credential not found')
  if (params.credential.type === 'personal_token')
    throw new OrchestrationError('validation', 'Personal tokens do not have shared members')
  const [target] = await db
    .select({ id: credentialMember.id, role: credentialMember.role })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, params.credential.id),
        eq(credentialMember.userId, params.targetUserId),
        eq(credentialMember.status, 'active')
      )
    )
    .limit(1)
  if (!target) throw new OrchestrationError('not_found', 'Member not found')

  if (isSharedCredentialType(params.credential.type)) {
    const targetWorkspacePermission = await getUserEntityPermissions(
      params.targetUserId,
      'workspace',
      params.credential.workspaceId
    )
    if (targetWorkspacePermission === 'admin') {
      throw new OrchestrationError(
        'validation',
        'Workspace admins are automatically credential admins and cannot be removed'
      )
    }
  }

  const revoked = await db.transaction(async (tx) => {
    if (!isSharedCredentialType(params.credential.type) && target.role === 'admin') {
      const activeAdmins = await tx
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, params.credential.id),
            eq(credentialMember.role, 'admin'),
            eq(credentialMember.status, 'active')
          )
        )
        .for('update')
      if (activeAdmins.length <= 1) return false
    }
    await tx
      .update(credentialMember)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(credentialMember.id, target.id))
    return true
  })
  if (!revoked) throw new OrchestrationError('validation', 'Cannot remove the last admin')
}

export async function listCredentialMembershipsForUser(userId: string) {
  const rows = await db
    .select({
      membershipId: credentialMember.id,
      credentialId: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      providerId: credential.providerId,
      role: credentialMember.role,
      status: credentialMember.status,
      joinedAt: credentialMember.joinedAt,
    })
    .from(credentialMember)
    .innerJoin(credential, eq(credentialMember.credentialId, credential.id))
    .where(
      and(
        eq(credentialMember.userId, userId),
        notInArray(credential.type, ['managed_oauth', 'managed_mcp'])
      )
    )
  return rows.flatMap((row) =>
    row.workspaceId
      ? [{ ...row, workspaceId: row.workspaceId, type: requireOrdinaryCredentialType(row.type) }]
      : []
  )
}

export async function leaveCredentialMembership(params: {
  userId: string
  credentialId: string
}): Promise<void> {
  const [membership] = await db
    .select()
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, params.credentialId),
        eq(credentialMember.userId, params.userId)
      )
    )
    .limit(1)
  if (!membership) throw new OrchestrationError('not_found', 'Membership not found')
  if (membership.status !== 'active') return

  const revoked = await db.transaction(async (tx) => {
    if (membership.role === 'admin') {
      const activeAdmins = await tx
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, params.credentialId),
            eq(credentialMember.role, 'admin'),
            eq(credentialMember.status, 'active')
          )
        )
        .for('update')
      if (activeAdmins.length <= 1) return false
    }
    await tx
      .update(credentialMember)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(credentialMember.id, membership.id))
    return true
  })
  if (!revoked) {
    throw new OrchestrationError('validation', 'Cannot leave credential as the last active admin')
  }
}
