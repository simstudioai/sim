import { db } from '@sim/db'
import { credential, credentialMember, member, permissions, user } from '@sim/db/schema'
import type { PermissionType } from '@sim/platform-authz/workspace'
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
import type { DbTransaction } from '@/lib/db/types'
import { inheritsOrganizationAdmin } from '@/lib/organizations/team-only'
import {
  getEffectiveWorkspacePermission,
  getUserEntityPermissions,
  getUsersWithPermissions,
  getWorkspaceWithOwner,
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
  /**
   * Whether the user holds an active explicit admin grant, independent of any
   * inherited workspace-admin role. This is what the last-admin guards count.
   */
  explicitAdmin: boolean
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
    explicitMembers.map((member) => [
      member.userId,
      {
        ...member,
        roleSource: 'explicit' as const,
        explicitAdmin: member.role === 'admin' && member.status === 'active',
      },
    ])
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
          explicitAdmin: false,
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
              inheritsOrganizationAdmin()
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
      explicitAdmin: sql<boolean>`coalesce(${credentialMember.role} = 'admin' and ${credentialMember.status} = 'active', false)`,
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

/**
 * Each person's effective role on the credential's workspace, read inside the caller's transaction
 * after it locked the credential, so a person removed or demoted meanwhile is seen as they are now.
 */
async function readWorkspaceRolesTx(
  tx: DbTransaction,
  workspaceId: string,
  userIds: Iterable<string>
): Promise<Map<string, PermissionType | null>> {
  const ws = await getWorkspaceWithOwner(workspaceId, { executor: tx })
  const roles = new Map<string, PermissionType | null>()
  for (const userId of userIds) {
    roles.set(userId, ws ? await getEffectiveWorkspacePermission(userId, ws, tx) : null)
  }
  return roles
}

/** Refuses a grant to someone outside the workspace, or below admin to a workspace admin. */
function assertGrantsAllowed(
  grants: Iterable<readonly [string, 'admin' | 'member']>,
  roles: ReadonlyMap<string, PermissionType | null>
) {
  for (const [userId, role] of grants) {
    const workspaceRole = roles.get(userId) ?? null
    if (workspaceRole === null)
      throw new OrchestrationError(
        'validation',
        'Target user must belong to the credential workspace'
      )
    if (workspaceRole === 'admin' && role !== 'admin')
      throw new OrchestrationError(
        'validation',
        'Workspace admins are automatically credential admins and cannot be demoted'
      )
  }
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
  const workspaceId = params.credential.workspaceId
  if (!workspaceId) throw new OrchestrationError('not_found', 'Credential not found')
  if (!isSharedCredentialType(params.credential.type)) {
    throw new OrchestrationError('validation', 'Personal credentials cannot be shared')
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.id, params.credential.id))
      .limit(1)
      .for('update')
    if (!locked) throw new OrchestrationError('not_found', 'Credential not found')
    assertGrantsAllowed(
      [[params.targetUserId, params.role]],
      await readWorkspaceRolesTx(tx, workspaceId, [params.targetUserId])
    )
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

export interface CredentialMemberGrant {
  userId: string
  role: 'admin' | 'member'
}

export interface SetCredentialMembersResult {
  added: CredentialMemberGrant[]
  roleChanged: { userId: string; fromRole: 'admin' | 'member'; toRole: 'admin' | 'member' }[]
  removed: string[]
}

/**
 * Makes a shared credential's explicit grants exactly `members` in one transaction: grants the
 * people it names, changes the roles that differ, and revokes everyone else's active or pending
 * grant. Every target is validated before anything is written, so one invalid person applies
 * nothing. Workspace admins are credential admins by inheritance: they cannot be demoted, and a
 * grant of theirs the list leaves out stays as it is. A credential that had an active explicit
 * admin keeps one.
 */
export async function setCredentialMembers(params: {
  credential: CredentialRow
  actorUserId: string
  members: readonly CredentialMemberGrant[]
}): Promise<SetCredentialMembersResult> {
  const workspaceId = params.credential.workspaceId
  if (!workspaceId) throw new OrchestrationError('not_found', 'Credential not found')
  if (!isSharedCredentialType(params.credential.type))
    throw new OrchestrationError('validation', 'Personal credentials cannot be shared')
  const desired = new Map(params.members.map((grant) => [grant.userId, grant.role]))
  if (desired.size !== params.members.length)
    throw new OrchestrationError('validation', 'Each person can be listed only once')

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.id, params.credential.id))
      .limit(1)
      .for('update')
    if (!locked) throw new OrchestrationError('not_found', 'Credential not found')
    const existing = await tx
      .select({
        id: credentialMember.id,
        userId: credentialMember.userId,
        role: credentialMember.role,
        status: credentialMember.status,
      })
      .from(credentialMember)
      .where(eq(credentialMember.credentialId, locked.id))
      .for('update')
    const workspaceRoles = await readWorkspaceRolesTx(
      tx,
      workspaceId,
      new Set([...desired.keys(), ...existing.map((row) => row.userId)])
    )
    assertGrantsAllowed(desired, workspaceRoles)
    const current = new Map(existing.map((row) => [row.userId, row]))
    const retained = existing.filter((row) => row.status !== 'revoked')
    const unlisted = retained.filter((row) => !desired.has(row.userId))
    const inherited = unlisted.filter((row) => workspaceRoles.get(row.userId) === 'admin')
    const removed = unlisted.filter((row) => workspaceRoles.get(row.userId) !== 'admin')
    const isActiveAdmin = (row: (typeof existing)[number]) =>
      row.status === 'active' && row.role === 'admin'
    const keepsAdmin =
      inherited.some(isActiveAdmin) ||
      [...desired].some(([userId, role]) => {
        const row = current.get(userId)
        return role === 'admin' && (!row || row.status !== 'pending' || row.role !== 'admin')
      })
    const hadAdmin = retained.some(isActiveAdmin)
    if (hadAdmin && !keepsAdmin)
      throw new OrchestrationError('validation', 'Cannot remove the last admin')

    const now = new Date()
    const result: SetCredentialMembersResult = { added: [], roleChanged: [], removed: [] }
    for (const [userId, role] of desired) {
      const row = current.get(userId)
      if (row && row.status !== 'revoked' && row.role === role) continue
      if (row) {
        await tx
          .update(credentialMember)
          .set({ role, status: 'active', updatedAt: now })
          .where(eq(credentialMember.id, row.id))
        if (row.status === 'revoked') result.added.push({ userId, role })
        else result.roleChanged.push({ userId, fromRole: row.role, toRole: role })
        continue
      }
      await tx.insert(credentialMember).values({
        id: generateId(),
        credentialId: locked.id,
        userId,
        role,
        status: 'active',
        joinedAt: now,
        invitedBy: params.actorUserId,
        createdAt: now,
        updatedAt: now,
      })
      result.added.push({ userId, role })
    }
    if (removed.length) {
      await tx
        .update(credentialMember)
        .set({ status: 'revoked', updatedAt: now })
        .where(
          inArray(
            credentialMember.id,
            removed.map((row) => row.id)
          )
        )
      result.removed = removed.map((row) => row.userId)
    }
    return result
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
