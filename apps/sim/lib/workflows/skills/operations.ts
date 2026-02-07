import { db } from '@sim/db'
import { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('SkillsOperations')

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
        id: nanoid(),
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
