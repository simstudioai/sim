import { db } from '@sim/db'
import { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { upsertSkills } from '@/lib/workflows/skills/operations'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SkillsAPI')

const SkillSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string().optional(),
      name: z
        .string()
        .min(1, 'Skill name is required')
        .max(64)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be kebab-case (e.g. my-skill)'),
      description: z.string().min(1, 'Description is required').max(1024),
      content: z.string().min(1, 'Content is required').max(50000, 'Content is too large'),
    })
  ),
  workspaceId: z.string().optional(),
})

/** GET - Fetch all skills for a workspace */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission) {
      logger.warn(`[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const result = await db
      .select()
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(desc(skill.createdAt))

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching skills:`, error)
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
}

/** POST - Create or update skills */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const body = await req.json()

    try {
      const { skills, workspaceId } = SkillSchema.parse(body)

      if (!workspaceId) {
        logger.warn(`[${requestId}] Missing workspaceId in request body`)
        return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
      }

      const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
        logger.warn(
          `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      const resultSkills = await upsertSkills({
        skills,
        workspaceId,
        userId,
        requestId,
      })

      return NextResponse.json({ success: true, data: resultSkills })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid skills data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      if (validationError instanceof Error && validationError.message.includes('already exists')) {
        return NextResponse.json({ error: validationError.message }, { status: 409 })
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating skills`, error)
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 })
  }
}

/** DELETE - Delete a skill by ID */
export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const skillId = searchParams.get('id')
  const workspaceId = searchParams.get('workspaceId')

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skill deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    if (!skillId) {
      logger.warn(`[${requestId}] Missing skill ID for deletion`)
      return NextResponse.json({ error: 'Skill ID is required' }, { status: 400 })
    }

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId for deletion`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      logger.warn(
        `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const existingSkill = await db.select().from(skill).where(eq(skill.id, skillId)).limit(1)

    if (existingSkill.length === 0) {
      logger.warn(`[${requestId}] Skill not found: ${skillId}`)
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    if (existingSkill[0].workspaceId !== workspaceId) {
      logger.warn(`[${requestId}] Skill ${skillId} does not belong to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    await db.delete(skill).where(and(eq(skill.id, skillId), eq(skill.workspaceId, workspaceId)))

    logger.info(`[${requestId}] Deleted skill: ${skillId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting skill:`, error)
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
}
