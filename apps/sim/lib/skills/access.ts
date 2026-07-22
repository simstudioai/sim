import { db } from '@sim/db'
import { skill, skillMember } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  getUsersWithPermissions,
  resolveWorkspaceAccess,
  type WorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

type SkillMemberRecord = typeof skillMember.$inferSelect
type SkillRecord = typeof skill.$inferSelect

export type SkillMemberRole = SkillMemberRecord['role']
export type SkillMemberStatus = SkillMemberRecord['status']

/**
 * The caller's effective role on a skill, or `null` when they have no access.
 *
 * Precedence: no workspace access → none; workspace admin → derived admin
 * (always, even over a revoked row — derived access can never be broken by
 * explicit rows); explicit active row → its role; explicit revoked row → deny
 * (a deliberate per-skill removal that overrides the workspace-shared grant);
 * `workspaceShared` → implicit member for any workspace member.
 *
 * Builtin skills are code-only and have no ACL; callers guard with
 * `isBuiltinSkillId` before reaching membership checks.
 */
export function resolveSkillRole(params: {
  workspaceShared: boolean
  memberRole: SkillMemberRole | null | undefined
  memberStatus: SkillMemberStatus | null | undefined
  workspaceAccess: Pick<WorkspaceAccess, 'hasAccess' | 'canAdmin'>
}): SkillMemberRole | null {
  if (!params.workspaceAccess.hasAccess) return null
  if (params.workspaceAccess.canAdmin) return 'admin'
  if (params.memberStatus === 'active') return params.memberRole ?? 'member'
  if (params.memberStatus === 'revoked') return null
  if (params.workspaceShared) return 'member'
  return null
}

export interface SkillActorContext {
  skill: SkillRecord | null
  /** The actor's effective role, or `null` when they cannot see/use the skill. */
  role: SkillMemberRole | null
}

/**
 * Resolves user access context for a skill. Pass `workspaceAccess` when the
 * caller has already resolved access for the skill's workspace (reused only
 * when it matches the skill's workspace), and `skillRow` when the caller has
 * already fetched the skill to skip the redundant select.
 */
export async function getSkillActorContext(
  skillId: string,
  userId: string,
  options?: { workspaceAccess?: WorkspaceAccess; skillRow?: SkillRecord }
): Promise<SkillActorContext> {
  const skillRow =
    options?.skillRow?.id === skillId
      ? options.skillRow
      : (await db.select().from(skill).where(eq(skill.id, skillId)).limit(1))[0]

  if (!skillRow?.workspaceId) {
    return { skill: skillRow ?? null, role: null }
  }

  const [workspaceAccess, [memberRow]] = await Promise.all([
    resolveWorkspaceAccess(skillRow.workspaceId, userId, options?.workspaceAccess),
    db
      .select()
      .from(skillMember)
      .where(and(eq(skillMember.skillId, skillId), eq(skillMember.userId, userId)))
      .limit(1),
  ])

  return {
    skill: skillRow,
    role: resolveSkillRole({
      workspaceShared: skillRow.workspaceShared,
      memberRole: memberRow?.role,
      memberStatus: memberRow?.status,
      workspaceAccess,
    }),
  }
}

export interface SkillAccessForUser {
  hasWorkspaceAccess: boolean
  canAdminWorkspace: boolean
  membershipBySkillId: Map<string, { role: SkillMemberRole; status: SkillMemberStatus }>
}

/**
 * Batch access surface for filtering many skills at once (list routes, prompt
 * construction, tool catalogs): one workspace-access lookup plus one membership
 * scan, then evaluate per skill with {@link resolveSkillRoleFromAccess}.
 */
export async function getSkillAccessForUser(
  workspaceId: string,
  userId: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<SkillAccessForUser> {
  const [workspaceAccess, membershipRows] = await Promise.all([
    resolveWorkspaceAccess(workspaceId, userId, options?.workspaceAccess),
    db
      .select({
        skillId: skillMember.skillId,
        role: skillMember.role,
        status: skillMember.status,
      })
      .from(skillMember)
      .innerJoin(skill, eq(skillMember.skillId, skill.id))
      .where(and(eq(skill.workspaceId, workspaceId), eq(skillMember.userId, userId))),
  ])

  const membershipBySkillId = new Map<
    string,
    { role: SkillMemberRole; status: SkillMemberStatus }
  >()
  for (const row of membershipRows) {
    membershipBySkillId.set(row.skillId, { role: row.role, status: row.status })
  }

  return {
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canAdminWorkspace: workspaceAccess.canAdmin,
    membershipBySkillId,
  }
}

/**
 * Per-skill role evaluation against a {@link getSkillAccessForUser} result.
 * Returns the effective role, or `null` when the user cannot see/use the skill.
 */
export function resolveSkillRoleFromAccess(
  skillRow: { id: string; workspaceShared: boolean },
  access: SkillAccessForUser
): SkillMemberRole | null {
  const membership = access.membershipBySkillId.get(skillRow.id)
  return resolveSkillRole({
    workspaceShared: skillRow.workspaceShared,
    memberRole: membership?.role,
    memberStatus: membership?.status,
    workspaceAccess: {
      hasAccess: access.hasWorkspaceAccess,
      canAdmin: access.canAdminWorkspace,
    },
  })
}

/** Whether the user can see/use a skill, given a batch access result. */
export function canUseSkill(
  skillRow: { id: string; workspaceShared: boolean },
  access: SkillAccessForUser
): boolean {
  return resolveSkillRoleFromAccess(skillRow, access) !== null
}

export type SkillMemberRoleSource = 'explicit' | 'workspace-admin' | 'workspace'

export interface SkillMemberEntry {
  /** Explicit row id, or a synthetic id for derived/implicit entries. */
  id: string
  userId: string
  role: SkillMemberRole
  /** `revoked` marks a deliberate per-skill deny (shown as removed, restorable). */
  status: SkillMemberStatus
  joinedAt: Date | null
  userName: string | null
  userEmail: string | null
  userImage: string | null
  roleSource: SkillMemberRoleSource
}

/**
 * The canonical member roster for a skill, scoped to what the viewer may see:
 * every CURRENT workspace member mapped through {@link resolveSkillRole}, so
 * the list always matches what enforcement grants. Workspace admins surface as
 * derived admins, explicit active rows as their role, and — while the skill is
 * workspace-shared — remaining members as implicit members. Revoked rows are
 * deliberate per-skill deny markers and exist to be restored, so they are
 * included only for skill-admin viewers; other members never learn who was
 * denied. Explicit rows for users no longer in the workspace are ignored,
 * exactly as enforcement ignores them.
 */
export async function listSkillMembers(
  skillRow: {
    id: string
    workspaceId: string
    workspaceShared: boolean
  },
  viewer: { role: SkillMemberRole }
): Promise<SkillMemberEntry[]> {
  const [explicitRows, workspaceMembers] = await Promise.all([
    db
      .select({
        id: skillMember.id,
        userId: skillMember.userId,
        role: skillMember.role,
        status: skillMember.status,
        joinedAt: skillMember.joinedAt,
      })
      .from(skillMember)
      .where(eq(skillMember.skillId, skillRow.id)),
    getUsersWithPermissions(skillRow.workspaceId),
  ])

  const rowByUser = new Map(explicitRows.map((row) => [row.userId, row]))

  const entries: SkillMemberEntry[] = []
  for (const wsMember of workspaceMembers) {
    const row = rowByUser.get(wsMember.userId)
    const canAdmin = wsMember.permissionType === 'admin'
    const role = resolveSkillRole({
      workspaceShared: skillRow.workspaceShared,
      memberRole: row?.role,
      memberStatus: row?.status,
      workspaceAccess: { hasAccess: true, canAdmin },
    })

    if (role === null) {
      // Entries only a deny marker would produce are admin-only data.
      if (row?.status !== 'revoked' || viewer.role !== 'admin') continue
    }

    entries.push({
      id: row?.id ?? `${canAdmin ? 'workspace-admin' : 'workspace'}-${wsMember.userId}`,
      userId: wsMember.userId,
      role: role ?? row?.role ?? 'member',
      status: role === null ? 'revoked' : 'active',
      joinedAt: row?.status === 'active' ? (row.joinedAt ?? null) : null,
      userName: wsMember.name,
      userEmail: wsMember.email,
      userImage: wsMember.image ?? null,
      roleSource: canAdmin ? 'workspace-admin' : row ? 'explicit' : 'workspace',
    })
  }
  return entries
}

export interface SkillsUpdateAccess {
  /** Ids from the request that resolve to existing skills in the workspace. */
  existingIds: Set<string>
  /**
   * Existing skills the user may not update, with their effective role so the
   * route can mask invisible skills (role `null` → not-found) and name only the
   * ones the caller can already see (role `member` → admin required).
   */
  denied: Array<{ id: string; name: string; role: SkillMemberRole | null }>
}

/**
 * Partitions an upsert request's skill ids for authorization: ids that resolve
 * to existing workspace skills require skill admin; unresolved ids are creates,
 * gated by workspace write permission instead.
 */
export async function checkSkillsUpdateAccess(params: {
  workspaceId: string
  userId: string
  skillIds: string[]
  workspaceAccess?: WorkspaceAccess
}): Promise<SkillsUpdateAccess> {
  if (params.skillIds.length === 0) return { existingIds: new Set(), denied: [] }

  const rows = await db
    .select({ id: skill.id, name: skill.name, workspaceShared: skill.workspaceShared })
    .from(skill)
    .where(and(eq(skill.workspaceId, params.workspaceId), inArray(skill.id, params.skillIds)))

  const existingIds = new Set(rows.map((row) => row.id))
  if (rows.length === 0) return { existingIds, denied: [] }

  const access = await getSkillAccessForUser(params.workspaceId, params.userId, {
    workspaceAccess: params.workspaceAccess,
  })
  const denied = rows.flatMap((row) => {
    const role = resolveSkillRoleFromAccess(row, access)
    return role === 'admin' ? [] : [{ id: row.id, name: row.name, role }]
  })

  return { existingIds, denied }
}

/**
 * Removes a user's explicit skill membership grants across one or more
 * workspaces when they leave (workspace removal, org removal/transfer).
 *
 * Active rows are deleted so a later re-invite lands them in the same state as
 * a brand-new member: implicit access to workspace-shared skills, no explicit
 * roles. Revoked rows are deliberate per-skill deny markers written by the
 * members route; they are kept so a per-skill removal survives leave/rejoin.
 * Workspace admins are derived skill admins, so no per-skill owner promotion is
 * needed to avoid orphaning a skill. Returns the number of grants removed.
 */
export async function removeWorkspaceSkillMembershipsTx(
  tx: DbOrTx,
  workspaceId: string | string[],
  userId: string
): Promise<number> {
  const workspaceIds = Array.isArray(workspaceId) ? workspaceId : [workspaceId]
  if (workspaceIds.length === 0) return 0

  const removed = await tx
    .delete(skillMember)
    .where(
      and(
        eq(skillMember.userId, userId),
        eq(skillMember.status, 'active'),
        inArray(
          skillMember.skillId,
          tx.select({ id: skill.id }).from(skill).where(inArray(skill.workspaceId, workspaceIds))
        )
      )
    )
    .returning({ id: skillMember.id })

  return removed.length
}
