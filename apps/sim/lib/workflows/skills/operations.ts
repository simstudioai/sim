import { db } from '@sim/db'
import { skill, skillMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, desc, eq, ne } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { getEditableSkillIds } from '@/lib/skills/access'
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

/** A skill row tagged with whether the caller can edit it (always false on builtins). */
export type SkillWithAccess = typeof skill.$inferSelect & { canEdit: boolean }

/**
 * List every skill in the workspace, each tagged with whether the caller can
 * edit it: workspace admins can edit all; others can edit skills where they
 * hold an explicit editor row. Everyone in the workspace sees and uses every
 * skill. Built-in template skills are code-only and never editable.
 *
 * Pass `workspaceAccess` when the caller already resolved it to skip a
 * redundant lookup.
 */
export async function listSkillsForUser(params: {
  workspaceId: string
  userId: string
  includeBuiltins?: boolean
  workspaceAccess?: WorkspaceAccess
}): Promise<SkillWithAccess[]> {
  const [dbRows, access] = await Promise.all([
    listSkills({ workspaceId: params.workspaceId, includeBuiltins: false }),
    getEditableSkillIds(params.workspaceId, params.userId, {
      workspaceAccess: params.workspaceAccess,
    }),
  ])

  const tagged: SkillWithAccess[] = dbRows.map((row) => ({
    ...row,
    canEdit: access.canAdminWorkspace || access.editorSkillIds.has(row.id),
  }))

  if (params.includeBuiltins === false) return tagged

  // A workspace skill that shares a built-in's name overrides it for everyone.
  const dbNames = new Set(tagged.map((r) => r.name.toLowerCase()))
  const builtins: SkillWithAccess[] = BUILTIN_SKILLS.filter(
    (b) => !dbNames.has(b.name.toLowerCase())
  ).map((b) => ({ ...builtinSkillRow(params.workspaceId, b), canEdit: false }))
  return [...builtins, ...tagged]
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
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      // The creator becomes an editor; workspace admins are derived editors
      // with no rows, and everyone in the workspace can already use the skill.
      await tx.insert(skillMember).values({
        id: generateId(),
        skillId: newId,
        userId,
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
