import { db } from '@sim/db'
import { skill, skillMember } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  getUsersWithPermissions,
  resolveWorkspaceAccess,
  type WorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

type SkillRecord = typeof skill.$inferSelect

export interface SkillActorContext {
  skill: SkillRecord | null
  /** Whether the actor can see and use the skill — plain workspace access. */
  hasWorkspaceAccess: boolean
  /**
   * Whether the actor can edit, delete, and share the skill: an explicit
   * `skill_member` editor row, or derived workspace admin (always, undemotable).
   */
  canEdit: boolean
}

/**
 * Resolves the acting user's context for a single skill. Everyone with
 * workspace access sees and uses every skill; editing is gated by the editors
 * list. Builtin skills are code-only and have no editors; callers guard with
 * `isBuiltinSkillId` before reaching this.
 */
export async function getSkillActorContext(
  skillId: string,
  userId: string
): Promise<SkillActorContext> {
  const [skillRow] = await db.select().from(skill).where(eq(skill.id, skillId)).limit(1)

  if (!skillRow?.workspaceId) {
    return { skill: skillRow ?? null, hasWorkspaceAccess: false, canEdit: false }
  }

  const [workspaceAccess, [editorRow]] = await Promise.all([
    resolveWorkspaceAccess(skillRow.workspaceId, userId),
    db
      .select({ id: skillMember.id })
      .from(skillMember)
      .where(and(eq(skillMember.skillId, skillId), eq(skillMember.userId, userId)))
      .limit(1),
  ])

  return {
    skill: skillRow,
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canEdit: workspaceAccess.hasAccess && (workspaceAccess.canAdmin || !!editorRow),
  }
}

export interface EditableSkillIds {
  /** Workspace admins are derived editors of every skill in the workspace. */
  canAdminWorkspace: boolean
  /** Skills where the user holds an explicit editor row. */
  editorSkillIds: Set<string>
}

/**
 * Batch edit-access surface for tagging many skills at once (list routes,
 * upsert authorization): one workspace-access lookup plus one editor-row scan
 * scoped to the workspace. A skill is editable when `canAdminWorkspace` or its
 * id is in `editorSkillIds`.
 *
 * Pass `workspaceAccess` when the caller already resolved it to skip a
 * redundant lookup.
 */
export async function getEditableSkillIds(
  workspaceId: string,
  userId: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<EditableSkillIds> {
  const [workspaceAccess, editorRows] = await Promise.all([
    resolveWorkspaceAccess(workspaceId, userId, options?.workspaceAccess),
    db
      .select({ skillId: skillMember.skillId })
      .from(skillMember)
      .innerJoin(skill, eq(skillMember.skillId, skill.id))
      .where(and(eq(skill.workspaceId, workspaceId), eq(skillMember.userId, userId))),
  ])

  if (!workspaceAccess.hasAccess) {
    return { canAdminWorkspace: false, editorSkillIds: new Set() }
  }

  return {
    canAdminWorkspace: workspaceAccess.canAdmin,
    editorSkillIds: new Set(editorRows.map((row) => row.skillId)),
  }
}

export interface SkillEditor {
  /** Explicit row id, or a synthetic `workspace-admin-<userId>` id for derived admins without rows. */
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
  /** Derived editors — always present, cannot be removed from the list. */
  isWorkspaceAdmin: boolean
}

/**
 * The editor roster for a skill: every workspace admin (derived, undemotable)
 * plus every explicit-row user still in the workspace roster. Rows for users
 * who left the workspace are ignored, exactly as edit enforcement ignores them.
 */
export async function listSkillEditors(skillRow: {
  id: string
  workspaceId: string
}): Promise<SkillEditor[]> {
  const [explicitRows, workspaceMembers] = await Promise.all([
    db
      .select({ id: skillMember.id, userId: skillMember.userId })
      .from(skillMember)
      .where(eq(skillMember.skillId, skillRow.id)),
    getUsersWithPermissions(skillRow.workspaceId),
  ])

  const rowByUser = new Map(explicitRows.map((row) => [row.userId, row]))

  const editors: SkillEditor[] = []
  for (const wsMember of workspaceMembers) {
    const row = rowByUser.get(wsMember.userId)
    const isWorkspaceAdmin = wsMember.permissionType === 'admin'
    if (!row && !isWorkspaceAdmin) continue

    editors.push({
      id: row?.id ?? `workspace-admin-${wsMember.userId}`,
      userId: wsMember.userId,
      userName: wsMember.name,
      userEmail: wsMember.email,
      userImage: wsMember.image ?? null,
      isWorkspaceAdmin,
    })
  }
  return editors
}

export interface SkillsUpdateAccess {
  /** Ids from the request that resolve to existing skills in the workspace. */
  existingIds: Set<string>
  /** Existing skills the user may not update (not an editor, not a workspace admin). */
  denied: Array<{ id: string; name: string }>
}

/**
 * Partitions an upsert request's skill ids for authorization: ids that resolve
 * to existing workspace skills require skill editor access; unresolved ids are
 * creates, gated by workspace write permission instead.
 */
export async function checkSkillsUpdateAccess(params: {
  workspaceId: string
  userId: string
  skillIds: string[]
  workspaceAccess?: WorkspaceAccess
}): Promise<SkillsUpdateAccess> {
  if (params.skillIds.length === 0) return { existingIds: new Set(), denied: [] }

  const rows = await db
    .select({ id: skill.id, name: skill.name })
    .from(skill)
    .where(and(eq(skill.workspaceId, params.workspaceId), inArray(skill.id, params.skillIds)))

  const existingIds = new Set(rows.map((row) => row.id))
  if (rows.length === 0) return { existingIds, denied: [] }

  const access = await getEditableSkillIds(params.workspaceId, params.userId, {
    workspaceAccess: params.workspaceAccess,
  })
  const denied = access.canAdminWorkspace
    ? []
    : rows.filter((row) => !access.editorSkillIds.has(row.id))

  return { existingIds, denied }
}

/**
 * Removes a user's skill editor grants across one or more workspaces when they
 * leave (workspace removal, org removal/transfer). Rows are editor grants
 * only — everyone in the workspace already sees and uses every skill — so a
 * later re-invite lands them with no edit rights until re-added. Workspace
 * admins are derived editors, so no promotion is needed to avoid orphaning a
 * skill. Returns the number of grants removed.
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
        inArray(
          skillMember.skillId,
          tx.select({ id: skill.id }).from(skill).where(inArray(skill.workspaceId, workspaceIds))
        )
      )
    )
    .returning({ id: skillMember.id })

  return removed.length
}
