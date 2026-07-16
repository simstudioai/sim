import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
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
import { captureServerEvent } from '@/lib/posthog/server'
import { checkSkillsUpdateAccess, getSkillActorContext } from '@/lib/skills/access'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { deleteSkill, listSkillsForUser, upsertSkills } from '@/lib/workflows/skills/operations'
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

    if (skills.some((s) => s.id && isBuiltinSkillId(s.id))) {
      return NextResponse.json({ error: 'Built-in skills are read-only' }, { status: 400 })
    }

    // Updating an existing skill requires skill admin (explicit member admin or
    // derived workspace admin); creating a new one requires workspace write.
    const requestedIds = skills.flatMap((s) => (s.id ? [s.id] : []))
    const { existingIds, denied } = await checkSkillsUpdateAccess({
      workspaceId,
      userId,
      skillIds: requestedIds,
      workspaceAccess,
    })

    const invisible = denied.filter((s) => s.role === null)
    if (invisible.length > 0) {
      logger.warn(`[${requestId}] User ${userId} cannot see skills being updated`, {
        skillIds: invisible.map((s) => s.id),
      })
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }
    if (denied.length > 0) {
      logger.warn(`[${requestId}] User ${userId} is not an admin of skills being updated`, {
        deniedSkillIds: denied.map((s) => s.id),
      })
      return NextResponse.json(
        {
          error: `Skill admin access required to update: ${denied.map((s) => s.name).join(', ')}`,
        },
        { status: 403 }
      )
    }

    const hasCreates = skills.some((s) => !s.id || !existingIds.has(s.id))
    if (hasCreates && !workspaceAccess.canWrite) {
      logger.warn(
        `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    try {
      const { touched } = await upsertSkills({
        skills,
        workspaceId,
        userId,
        requestId,
        returnSkills: false,
      })

      for (const { id, name, operation } of touched) {
        const isUpdate = operation === 'updated'
        recordAudit({
          workspaceId,
          actorId: userId,
          actorName: authResult.userName ?? undefined,
          actorEmail: authResult.userEmail ?? undefined,
          action: isUpdate ? AuditAction.SKILL_UPDATED : AuditAction.SKILL_CREATED,
          resourceType: AuditResourceType.SKILL,
          resourceId: id,
          resourceName: name,
          description: `${isUpdate ? 'Updated' : 'Created'} skill "${name}"`,
          metadata: { source },
        })
        captureServerEvent(
          userId,
          isUpdate ? 'skill_updated' : 'skill_created',
          { skill_id: id, skill_name: name, workspace_id: workspaceId, source },
          { groups: { workspace: workspaceId } }
        )
      }

      const resultSkills = await listSkillsForUser({ workspaceId, userId, workspaceAccess })
      const data = resultSkills.map((s) => ({ ...s, readOnly: isBuiltinSkillId(s.id) }))

      return NextResponse.json({ success: true, data })
    } catch (upsertError) {
      if (upsertError instanceof Error && upsertError.message.includes('is unavailable')) {
        return NextResponse.json({ error: upsertError.message }, { status: 409 })
      }
      if (upsertError instanceof Error && upsertError.message.startsWith('Skill not found')) {
        return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
      }
      throw upsertError
    }
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

    if (!isBuiltinSkillId(skillId)) {
      const actor = await getSkillActorContext(skillId, userId)
      if (!actor.skill || actor.skill.workspaceId !== workspaceId || actor.role === null) {
        logger.warn(`[${requestId}] Skill not found: ${skillId}`)
        return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
      }
      if (actor.role !== 'admin') {
        logger.warn(`[${requestId}] User ${userId} is not an admin of skill ${skillId}`)
        return NextResponse.json({ error: 'Skill admin access required' }, { status: 403 })
      }
    }

    const deleted = await deleteSkill({ skillId, workspaceId })
    if (!deleted) {
      logger.warn(`[${requestId}] Skill not found: ${skillId}`)
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    recordAudit({
      workspaceId,
      actorId: authResult.userId,
      actorName: authResult.userName ?? undefined,
      actorEmail: authResult.userEmail ?? undefined,
      action: AuditAction.SKILL_DELETED,
      resourceType: AuditResourceType.SKILL,
      resourceId: skillId,
      description: `Deleted skill`,
      metadata: { source },
    })

    captureServerEvent(
      userId,
      'skill_deleted',
      { skill_id: skillId, workspace_id: workspaceId, source },
      { groups: { workspace: workspaceId } }
    )

    logger.info(`[${requestId}] Deleted skill: ${skillId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting skill:`, error)
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
})
