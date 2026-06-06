import { db } from '@sim/db'
import { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, desc, eq, ne } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('SkillsOperations')

/**
 * List all skills for a workspace, ordered by createdAt desc.
 */
export async function listSkills(params: { workspaceId: string }) {
  return db
    .select()
    .from(skill)
    .where(eq(skill.workspaceId, params.workspaceId))
    .orderBy(desc(skill.createdAt))
}

/**
 * Delete a skill by ID within a workspace.
 * Returns true if the skill was found and deleted, false otherwise.
 */
export async function deleteSkill(params: {
  skillId: string
  workspaceId: string
}): Promise<boolean> {
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
  /** Every skill in the workspace after the upsert, ordered by createdAt desc. */
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
    name: string
    description: string
    content: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}): Promise<UpsertSkillsResult> {
  const { skills, workspaceId, userId, requestId = generateRequestId() } = params

  return await db.transaction(async (tx) => {
    const touched: TouchedSkill[] = []

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

          touched.push({ id: s.id, name: s.name, operation: 'updated' })
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

      touched.push({ id: newId, name: s.name, operation: 'created' })
      logger.info(`[${requestId}] Created skill "${s.name}"`)
    }

    const resultSkills = await tx
      .select()
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(desc(skill.createdAt))

    return { skills: resultSkills, touched }
  })
}
