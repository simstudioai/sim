import { db } from '@sim/db'
import { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, desc, eq, ne } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  BUILTIN_SKILLS,
  type BuiltinSkill,
  getBuiltinSkillById,
  isBuiltinSkillId,
} from '@/lib/workflows/skills/builtin-skills'

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
 * mothership uses this for the skill registry it sees, since it loads workspace
 * skills via load_user_skill and never the code-only templates.
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

/**
 * Internal function to create/update skills.
 * Can be called from API routes or internal services.
 */
export async function upsertSkills(params: {
  skills: Array<{
    id?: string
    name: string
    description: string
    content: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}) {
  const { skills, workspaceId, userId, requestId = generateRequestId() } = params

  // Built-in template skills are read-only and must never be written to the DB.
  if (skills.some((s) => s.id && isBuiltinSkillId(s.id))) {
    throw new Error('Built-in skills are read-only and cannot be modified')
  }

  return await db.transaction(async (tx) => {
    for (const s of skills) {
      const nowTime = new Date()

      if (s.id) {
        const existingSkill = await tx
          .select()
          .from(skill)
          .where(and(eq(skill.id, s.id), eq(skill.workspaceId, workspaceId)))
          .limit(1)

        if (existingSkill.length > 0) {
          if (s.name !== existingSkill[0].name) {
            const nameConflict = await tx
              .select({ id: skill.id })
              .from(skill)
              .where(
                and(eq(skill.workspaceId, workspaceId), eq(skill.name, s.name), ne(skill.id, s.id))
              )
              .limit(1)

            if (nameConflict.length > 0) {
              throw new Error(`A skill with the name "${s.name}" already exists in this workspace`)
            }
          }

          await tx
            .update(skill)
            .set({
              name: s.name,
              description: s.description,
              content: s.content,
              updatedAt: nowTime,
            })
            .where(and(eq(skill.id, s.id), eq(skill.workspaceId, workspaceId)))

          logger.info(`[${requestId}] Updated skill ${s.id}`)
          continue
        }
      }

      const duplicateName = await tx
        .select()
        .from(skill)
        .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, s.name)))
        .limit(1)

      if (duplicateName.length > 0) {
        throw new Error(`A skill with the name "${s.name}" already exists in this workspace`)
      }

      await tx.insert(skill).values({
        id: generateShortId(),
        workspaceId,
        userId,
        name: s.name,
        description: s.description,
        content: s.content,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      logger.info(`[${requestId}] Created skill "${s.name}"`)
    }

    const resultSkills = await tx
      .select()
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(desc(skill.createdAt))

    return resultSkills
  })
}
