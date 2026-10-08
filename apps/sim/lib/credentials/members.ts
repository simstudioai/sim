import { db } from '@sim/db'
import { credential, credentialMember, member, permissions, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, exists, inArray, notInArray, or, sql } from 'drizzle-orm'
import {
  type CursorKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  textKey,
} from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isSharedCredentialType, requireOrdinaryCredentialType } from '@/lib/credentials/access'
import type { CredentialAuthorizationContext } from '@/lib/credentials/application/authorized-credential-use-case'
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
  userImage: string | null
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
      userImage: user.image,
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
          userImage: workspaceMember.image ?? null,
          roleSource: 'workspace-admin',
        })
      }
    }
  }

  return Array.from(byUser.values())
}

export interface CredentialMemberPageInput {
  limit: number
  sortBy: 'email' | 'name'
  sortOrder: ListSortOrder
  cursorKeys?: CursorKey[]
}

/** Reads effective credential membership with a bounded SQL keyset, including inherited admins. */
export async function listCredentialMembersPage(
  context: CredentialAuthorizationContext,
  input: CredentialMemberPageInput
) {
  const workspaceAdmin = exists(
    db
      .select({ found: sql`1` })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, user.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, context.workspaceId),
          eq(permissions.permissionType, 'admin')
        )
      )
  )
  const organizationAdmin = context.workspaceOrganizationId
    ? exists(
        db
          .select({ found: sql`1` })
          .from(member)
          .where(
            and(
              eq(member.userId, user.id),
              eq(member.organizationId, context.workspaceOrganizationId),
              inArray(member.role, ['owner', 'admin'])
            )
          )
      )
    : sql`false`
  const inheritedAdmin = isSharedCredentialType(context.credential.type)
    ? sql<boolean>`(${workspaceAdmin} or ${organizationAdmin})`
    : sql<boolean>`false`
  const sortKeys = [
    input.sortBy === 'name'
      ? textKey(user.name, (row: CredentialMemberView) => row.userName ?? '')
      : textKey(user.email, (row: CredentialMemberView) => row.userEmail ?? ''),
    textKey(user.id, (row: CredentialMemberView) => row.userId),
  ]
  const rows = await db
    .select({
      id: sql<string>`coalesce(${credentialMember.id}, 'workspace-admin-' || ${user.id})`,
      userId: user.id,
      role: sql<
        'admin' | 'member'
      >`case when ${inheritedAdmin} then 'admin' else ${credentialMember.role} end`,
      status: sql<
        'active' | 'pending' | 'revoked'
      >`case when ${inheritedAdmin} then 'active' else ${credentialMember.status} end`,
      joinedAt: credentialMember.joinedAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
      roleSource: sql<
        'explicit' | 'workspace-admin'
      >`case when ${inheritedAdmin} then 'workspace-admin' else 'explicit' end`,
    })
    .from(user)
    .leftJoin(
      credentialMember,
      and(
        eq(credentialMember.userId, user.id),
        eq(credentialMember.credentialId, context.credential.id)
      )
    )
    .where(
      and(
        or(sql`${credentialMember.id} is not null`, inheritedAdmin),
        resumeKeyset(sortKeys, input.cursorKeys, input.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(sortKeys), input.sortOrder))
    .limit(input.limit + 1)
  const page = keysetPage(sortKeys, rows, input.limit)
  return { members: page.data, nextCursorKeys: page.nextCursorKeys }
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

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.id, params.credential.id))
      .limit(1)
      .for('update')
    if (!locked) throw new OrchestrationError('not_found', 'Credential not found')
    const [existing] = await tx
      .select({ id: credentialMember.id, role: credentialMember.role })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, locked.id),
          eq(credentialMember.userId, params.targetUserId)
        )
      )
      .limit(1)
      .for('update')
    const now = new Date()
    if (existing) {
      await tx
        .update(credentialMember)
        .set({ role: params.role, status: 'active', updatedAt: now })
        .where(eq(credentialMember.id, existing.id))
      return { created: false, previousRole: existing.role }
    }
    await tx.insert(credentialMember).values({
      id: generateId(),
      credentialId: locked.id,
      userId: params.targetUserId,
      role: params.role,
      status: 'active',
      joinedAt: now,
      invitedBy: params.actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    return { created: true }
  })
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
    const [lockedCredential] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.id, params.credential.id))
      .limit(1)
      .for('update')
    if (!lockedCredential) throw new OrchestrationError('not_found', 'Credential not found')
    const [activeTarget] = await tx
      .select({ id: credentialMember.id, role: credentialMember.role })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, lockedCredential.id),
          eq(credentialMember.userId, params.targetUserId),
          eq(credentialMember.status, 'active')
        )
      )
      .limit(1)
      .for('update')
    if (!activeTarget) throw new OrchestrationError('not_found', 'Member not found')
    if (!isSharedCredentialType(params.credential.type) && activeTarget.role === 'admin') {
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
    const removed = await tx
      .update(credentialMember)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(credentialMember.id, activeTarget.id), eq(credentialMember.status, 'active')))
      .returning({ id: credentialMember.id })
    if (!removed.length) throw new OrchestrationError('not_found', 'Member not found')
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
