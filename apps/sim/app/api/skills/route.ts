import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteSkillQuerySchema,
  listSkillsQuerySchema,
  upsertSkillsContract,
} from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performCreateSkill,
  performDeleteSkill,
  performUpdateSkill,
  statusForSkillOrchestrationError,
} from '@/lib/skills/orchestration'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { listSkillsForUser } from '@/lib/workflows/skills/operations'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SkillsAPI')

/** GET - Fetch all skills for a workspace */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const query = listSkillsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!query.success) {
      logger.warn(`[${requestId}] Invalid skills query`, { errors: query.error.issues })
      return NextResponse.json(
        { error: 'Invalid request data', details: query.error.issues },
        { status: 400 }
      )
    }
    const { workspaceId } = query.data

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.hasAccess) {
      logger.warn(`[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const result = await listSkillsForUser({ workspaceId, userId, workspaceAccess })
    const data = result.map((s) => ({ ...s, readOnly: isBuiltinSkillId(s.id) }))

    return NextResponse.json({ data }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching skills:`, error)
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
})

/** POST - Create or update skills */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    const parsed = await parseRequest(
      upsertSkillsContract,
      req,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid skills data`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid request data')
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { skills, workspaceId, source } = parsed.data.body

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.hasAccess) {
      logger.warn(`[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    /**
     * Each item is applied through the skill orchestration, which owns the
     * built-in guard, the field limits, the per-skill editor check, and the
     * audit. Creating still requires workspace write; editing an existing skill
     * is gated per skill inside `performUpdateSkill`.
     *
     * The batch is applied item by item rather than in one transaction: this
     * endpoint's callers submit a single skill, and one shared authority for the
     * rules is worth more than atomicity across a batch nobody sends.
     */
    const actor = {
      actorName: authResult.userName,
      actorEmail: authResult.userEmail,
      source,
      request: req,
    }

    for (const item of skills) {
      if (item.id) {
        const result = await performUpdateSkill({
          workspaceId,
          userId,
          skillId: item.id,
          name: item.name,
          description: item.description,
          content: item.content,
          ...actor,
        })
        if (!result.success) {
          logger.warn(`[${requestId}] Skill update rejected`, {
            skillId: item.id,
            errorCode: result.errorCode,
          })
          return NextResponse.json(
            { error: result.error ?? 'Failed to update skill' },
            { status: statusForSkillOrchestrationError(result.errorCode) }
          )
        }
        continue
      }

      if (!workspaceAccess.canWrite) {
        logger.warn(
          `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      const result = await performCreateSkill({
        workspaceId,
        userId,
        name: item.name!,
        description: item.description!,
        content: item.content!,
        ...actor,
      })
      if (!result.success) {
        logger.warn(`[${requestId}] Skill create rejected`, { errorCode: result.errorCode })
        return NextResponse.json(
          { error: result.error ?? 'Failed to create skill' },
          { status: statusForSkillOrchestrationError(result.errorCode) }
        )
      }
    }

    const resultSkills = await listSkillsForUser({ workspaceId, userId, workspaceAccess })
    const data = resultSkills.map((s) => ({ ...s, readOnly: isBuiltinSkillId(s.id) }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    logger.error(`[${requestId}] Error updating skills`, error)
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 })
  }
})

/** DELETE - Delete a skill by ID */
export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skill deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const query = deleteSkillQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    )
    if (!query.success) {
      logger.warn(`[${requestId}] Invalid skill deletion query`, { errors: query.error.issues })
      return NextResponse.json(
        { error: 'Invalid request data', details: query.error.issues },
        { status: 400 }
      )
    }
    const { id: skillId, workspaceId, source } = query.data

    const result = await performDeleteSkill({
      workspaceId,
      userId,
      skillId,
      actorName: authResult.userName,
      actorEmail: authResult.userEmail,
      source,
      request,
    })
    if (!result.success) {
      logger.warn(`[${requestId}] Skill delete rejected`, {
        skillId,
        errorCode: result.errorCode,
      })
      return NextResponse.json(
        { error: result.error ?? 'Failed to delete skill' },
        { status: statusForSkillOrchestrationError(result.errorCode) }
      )
    }

    logger.info(`[${requestId}] Deleted skill: ${skillId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting skill:`, error)
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
})
