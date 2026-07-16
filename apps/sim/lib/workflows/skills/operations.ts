import { db } from '@sim/db'
import { skill, skillMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, desc, eq, ne } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  getSkillAccessForUser,
  resolveSkillRoleFromAccess,
  type SkillMemberRole,
} from '@/lib/skills/access'
import {
  BUILTIN_SKILLS,
  type BuiltinSkill,
  getBuiltinSkillById,
  isBuiltinSkillId,
} from '@/lib/workflows/skills/builtin-skills'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SkillsOperations')

/** Stable epoch timestamp for built-in (template) skills, which have no DB row. */
const BUILTIN_SKILL_TIMESTAMP = new Date(0)

/** Shape a built-in skill as a `skill` table row so it can ride alongside DB skills. */
function builtinSkillRow(workspaceId: string, builtin: BuiltinSkill): typeof skill.$inferSelect {
  return {
    id: builtin.id,
    workspaceId,
    userId: null,
    name: builtin.name,
    description: builtin.description,
    content: builtin.content,
    workspaceShared: true,
    createdAt: BUILTIN_SKILL_TIMESTAMP,
    updatedAt: BUILTIN_SKILL_TIMESTAMP,
  }
}

/**
 * List skills for a workspace, ordered by createdAt desc. Built-in template
 * skills are prepended (they live in code, not the DB) so they appear wherever
 * real skills do. A workspace skill that shares a built-in's name overrides it.
 *
 * Pass `includeBuiltins: false` to return only user-created skills. The
 * mothership uses this for the workspace skill inventory it sees, which lists
 * only user-created skills and never the code-only templates.
 */
export async function listSkills(params: { workspaceId: string; includeBuiltins?: boolean }) {
  const dbRows = await db
    .select()
    .from(skill)
    .where(eq(skill.workspaceId, params.workspaceId))
    .orderBy(desc(skill.createdAt))

  if (params.includeBuiltins === false) {
    return dbRows
  }

  const dbNames = new Set(dbRows.map((r) => r.name.toLowerCase()))
  const builtins = BUILTIN_SKILLS.filter((b) => !dbNames.has(b.name.toLowerCase())).map((b) =>
    builtinSkillRow(params.workspaceId, b)
  )
  return [...builtins, ...dbRows]
}

/** A skill row tagged with the caller's effective role (`null` on builtins — no ACL). */
export type SkillWithRole = typeof skill.$inferSelect & { role: SkillMemberRole | null }

/**
 * List the skills a user can see/use in a workspace, each tagged with the
 * user's effective role: workspace admins see every skill as `admin`; others
 * see skills where they hold an active membership (its role) or that are
 * workspace-shared (implicit `member`, unless individually revoked). Built-in
 * template skills have no ACL and always pass through with `role: null`.
 *
 * Pass `workspaceAccess` when the caller already resolved it to skip a
 * redundant lookup.
 */
export async function listSkillsForUser(params: {
  workspaceId: string
  userId: string
  includeBuiltins?: boolean
  workspaceAccess?: WorkspaceAccess
}): Promise<SkillWithRole[]> {
  const [dbRows, access] = await Promise.all([
    listSkills({ workspaceId: params.workspaceId, includeBuiltins: false }),
    getSkillAccessForUser(params.workspaceId, params.userId, {
      workspaceAccess: params.workspaceAccess,
    }),
  ])

  const visible: SkillWithRole[] = []
  for (const row of dbRows) {
    const role = resolveSkillRoleFromAccess(row, access)
    if (role === null) continue
    visible.push({ ...row, role })
  }

  if (params.includeBuiltins === false) return visible

  // Built-ins are deduped against the rows the caller can actually SEE, so a
  // restricted skill shadowing a built-in's name hides the built-in only from
  // users who can see the override — never from everyone.
  const visibleNames = new Set(visible.map((r) => r.name.toLowerCase()))
  const builtins: SkillWithRole[] = BUILTIN_SKILLS.filter(
    (b) => !visibleNames.has(b.name.toLowerCase())
  ).map((b) => ({ ...builtinSkillRow(params.workspaceId, b), role: null }))
  return [...builtins, ...visible]
}

/**
 * Fetch a single skill by id, scoped to a workspace. Built-in template skills
 * resolve from code; otherwise returns the DB row, or null when the skill does
 * not exist or belongs to a different workspace.
 */
export async function getSkillById(params: { skillId: string; workspaceId: string }) {
  const builtin = getBuiltinSkillById(params.skillId)
  if (builtin) return builtinSkillRow(params.workspaceId, builtin)

  const rows = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Delete a skill by ID within a workspace.
 * Returns true if the skill was found and deleted, false otherwise.
 */
export async function deleteSkill(params: {
  skillId: string
  workspaceId: string
}): Promise<boolean> {
  // Built-in template skills have no DB row and cannot be deleted.
  if (isBuiltinSkillId(params.skillId)) return false

  const existing = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))
    .limit(1)

  if (existing.length === 0) return false

  await db
    .delete(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, params.workspaceId)))

  logger.info(`Deleted skill ${params.skillId}`)
  return true
}

/** Whether a given skill in an upsert was newly inserted or an existing row updated. */
export type SkillUpsertOperation = 'created' | 'updated'

/** A skill touched by an upsert, tagged with whether it was created or updated. */
export interface TouchedSkill {
  id: string
  name: string
  operation: SkillUpsertOperation
}

export interface UpsertSkillsResult {
  /**
   * Every skill in the workspace after the upsert, ordered by createdAt desc.
   * Empty when `returnSkills: false` — callers that re-fetch a filtered list
   * themselves opt out so the transaction never re-reads full content bodies.
   */
  skills: Awaited<ReturnType<typeof listSkills>>
  /** Only the skills this upsert created or updated, tagged with the operation. */
  touched: TouchedSkill[]
}

/**
 * Internal function to create/update skills.
 * Can be called from API routes or internal services.
 */
export async function upsertSkills(params: {
  skills: Array<{
    id?: string
    name?: string
    description?: string
    content?: string
    workspaceShared?: boolean
  }>
  workspaceId: string
  userId: string
  requestId?: string
  returnSkills?: boolean
}): Promise<UpsertSkillsResult> {
  const { skills, workspaceId, userId, requestId = generateRequestId() } = params

  // Built-in template skills are read-only and must never be written to the DB.
  if (skills.some((s) => s.id && isBuiltinSkillId(s.id))) {
    throw new Error('Built-in skills are read-only and cannot be modified')
  }

  return await db.transaction(async (tx) => {
    const touched: TouchedSkill[] = []

    for (const s of skills) {
      const nowTime = new Date()

      if (s.id) {
        // Id-carrying items are updates and never fall through to a create: the
        // caller's authorization partitioned on resolvability, so a vanished id
        // must surface as not-found rather than an ungated (re-)create.
        const [current] = await tx
          .select()
          .from(skill)
          .where(and(eq(skill.id, s.id), eq(skill.workspaceId, workspaceId)))
          .limit(1)

        if (!current) {
          throw new Error(`Skill not found: ${s.id}`)
        }

        // Partial update: omitted fields keep their current values, so a
        // sharing-only toggle can never clobber a concurrent content edit.
        const nextName = s.name ?? current.name
        if (nextName !== current.name) {
          const nameConflict = await tx
            .select({ id: skill.id })
            .from(skill)
            .where(
              and(eq(skill.workspaceId, workspaceId), eq(skill.name, nextName), ne(skill.id, s.id))
            )
            .limit(1)

          if (nameConflict.length > 0) {
            throw new Error(`The skill name "${nextName}" is unavailable in this workspace`)
          }
        }

        await tx
          .update(skill)
          .set({
            name: nextName,
            description: s.description ?? current.description,
            content: s.content ?? current.content,
            ...(s.workspaceShared !== undefined ? { workspaceShared: s.workspaceShared } : {}),
            updatedAt: nowTime,
          })
          .where(and(eq(skill.id, s.id), eq(skill.workspaceId, workspaceId)))

        touched.push({ id: s.id, name: nextName, operation: 'updated' })
        logger.info(`[${requestId}] Updated skill ${s.id}`)
        continue
      }

      if (!s.name || !s.description || !s.content) {
        throw new Error('Skill name, description, and content are required to create a skill')
      }

      const duplicateName = await tx
        .select()
        .from(skill)
        .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, s.name)))
        .limit(1)

      if (duplicateName.length > 0) {
        throw new Error(`The skill name "${s.name}" is unavailable in this workspace`)
      }

      const newId = generateShortId()
      await tx.insert(skill).values({
        id: newId,
        workspaceId,
        userId,
        name: s.name,
        description: s.description,
        content: s.content,
        workspaceShared: s.workspaceShared ?? true,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      // The creator is the skill's only explicit admin; everyone else gets
      // implicit member access while the skill stays workspace-shared, and
      // workspace admins are derived admins with no rows.
      await tx.insert(skillMember).values({
        id: generateId(),
        skillId: newId,
        userId,
        role: 'admin',
        status: 'active',
        joinedAt: nowTime,
        invitedBy: userId,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      touched.push({ id: newId, name: s.name, operation: 'created' })
      logger.info(`[${requestId}] Created skill "${s.name}"`)
    }

    if (params.returnSkills === false) {
      return { skills: [], touched }
    }

    const resultSkills = await tx
      .select()
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(desc(skill.createdAt))

    return { skills: resultSkills, touched }
  })
}
