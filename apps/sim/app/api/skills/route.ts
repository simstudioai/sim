import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteSkillQuerySchema,
  listSkillsQuerySchema,
  upsertSkillsContract,
} from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  deleteSkillUseCase,
  listAvailableSkillsUseCase,
  upsertSkillsUseCase,
} from '@/lib/skills/application/use-cases'
import type { SkillWriteSource } from '@/lib/skills/orchestration'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'

const logger = createLogger('SkillsAPI')

/**
 * This surface authenticates, parses, presents, and emits analytics. Every
 * authorization decision and the semantic audit entry belong to the skill
 * application use cases, which the v2 routes and copilot call as well.
 *
 * Only an interactive session can reach it: the skill operations model human
 * principals (session, personal API key, copilot delegation), and the legacy
 * internal executor JWT this route previously accepted has no principal that
 * those policies can express.
 */
async function authenticatePrincipal(): Promise<SessionPrincipal | null> {
  try {
    return await internalSessionAuth.authenticate()
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) return null
    throw error
  }
}

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

/** Projects a classified use-case failure onto this surface's error body. */
function orchestrationErrorResponse(error: unknown, fallback: string): NextResponse | null {
  const classified = asOrchestrationError(error)
  if (!classified) return null
  return NextResponse.json(
    {
      error: messageForOrchestrationError(
        { error: classified.message, errorCode: classified.code },
        fallback
      ),
    },
    { status: statusForOrchestrationError(classified.code) }
  )
}

interface SkillListRow {
  id: string
}

const withReadOnly = <T extends SkillListRow>(skills: T[]) =>
  skills.map((s) => ({ ...s, readOnly: isBuiltinSkillId(s.id) }))

/** GET - Fetch all skills for a workspace */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const principal = await authenticatePrincipal()
    if (!principal) {
      logger.warn(`[${requestId}] Unauthorized skills access attempt`)
      return unauthorized()
    }

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

    const { skills } = await listAvailableSkillsUseCase.execute({
      principal,
      input: { workspaceId: query.data.workspaceId },
      request,
    })

    return NextResponse.json({ data: withReadOnly(skills) }, { status: 200 })
  } catch (error) {
    const projected = orchestrationErrorResponse(error, 'Failed to fetch skills')
    if (projected) return projected
    logger.error(`[${requestId}] Error fetching skills:`, error)
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
})

/** POST - Create or update skills */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const principal = await authenticatePrincipal()
    if (!principal) {
      logger.warn(`[${requestId}] Unauthorized skills update attempt`)
      return unauthorized()
    }

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

    /**
     * The whole batch is one semantic operation: the use case authorizes every
     * item before writing any of them and commits them together, so a rejected
     * item cannot leave earlier ones persisted. Analytics follows the commit,
     * one event per skill actually written.
     */
    const { touched } = await upsertSkillsUseCase.execute({
      principal,
      input: { workspaceId, skills, source },
      request: req,
    })

    for (const entry of touched) {
      captureSkillEvent(
        entry.operation === 'created' ? 'skill_created' : 'skill_updated',
        principal.userId,
        workspaceId,
        source,
        entry
      )
    }

    const { skills: resultSkills } = await listAvailableSkillsUseCase.execute({
      principal,
      input: { workspaceId },
      request: req,
    })

    return NextResponse.json({ success: true, data: withReadOnly(resultSkills) })
  } catch (error) {
    const projected = orchestrationErrorResponse(error, 'Failed to update skills')
    if (projected) {
      logger.warn(`[${requestId}] Skill write rejected`, { status: projected.status })
      return projected
    }
    logger.error(`[${requestId}] Error updating skills`, error)
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 })
  }
})

/** DELETE - Delete a skill by ID */
export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const principal = await authenticatePrincipal()
    if (!principal) {
      logger.warn(`[${requestId}] Unauthorized skill deletion attempt`)
      return unauthorized()
    }

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

    const { skill } = await deleteSkillUseCase.execute({
      principal,
      input: { workspaceId, skillId, source },
      request,
    })

    captureServerEvent(
      principal.userId,
      'skill_deleted',
      { skill_id: skill.id, workspace_id: workspaceId, source },
      { groups: { workspace: workspaceId } }
    )

    logger.info(`[${requestId}] Deleted skill: ${skillId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    const projected = orchestrationErrorResponse(error, 'Failed to delete skill')
    if (projected) {
      logger.warn(`[${requestId}] Skill delete rejected`, { status: projected.status })
      return projected
    }
    logger.error(`[${requestId}] Error deleting skill:`, error)
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
})

/**
 * Analytics stays on the surface, as it does on the v2 routes: the use case
 * owns audit, each adapter owns its own product telemetry.
 */
function captureSkillEvent(
  event: 'skill_created' | 'skill_updated',
  userId: string,
  workspaceId: string,
  source: SkillWriteSource | undefined,
  skill: { id: string; name: string }
): void {
  captureServerEvent(
    userId,
    event,
    { skill_id: skill.id, skill_name: skill.name, workspace_id: workspaceId, source },
    { groups: { workspace: workspaceId } }
  )
}
