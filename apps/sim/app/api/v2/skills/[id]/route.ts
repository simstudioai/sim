import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteSkillContract,
  v2GetSkillContract,
  v2UpdateSkillContract,
} from '@/lib/api/contracts/v2/skills'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performDeleteSkill, performUpdateSkill } from '@/lib/skills/orchestration'
import { getSkillById } from '@/lib/workflows/skills/operations'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toV2Skill, v2SkillOrchestrationError } from '@/app/api/v2/skills/utils'

const logger = createLogger('V2SkillDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/skills/[id] — Fetch a single skill, including its body. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'skill-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetSkillContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const skill = await getSkillById({ skillId: id, workspaceId })
    if (!skill) return v2Error('NOT_FOUND', 'Skill not found')

    return v2Data({ skill: toV2Skill(skill) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching skill`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/skills/[id] — Update a skill. Omitted fields keep their values. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'skill-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateSkillContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, name, description, content } = parsed.data.body

    /**
     * Editing an existing skill is gated per skill, not per workspace: an
     * explicit editor grant (or workspace admin) is the authority, and
     * `performUpdateSkill` enforces it. Requiring workspace `write` here would
     * reject a legitimate skill editor who only holds `read` — stricter than the
     * UI and than what this endpoint documents. Creating still needs `write`.
     */
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performUpdateSkill({
      workspaceId,
      userId,
      skillId: id,
      name,
      description,
      content,
      source: 'api',
      request,
    })

    if (!result.success || !result.skill) {
      return v2SkillOrchestrationError(result.errorCode, result.error ?? 'Failed to update skill')
    }

    return v2Data({ skill: toV2Skill(result.skill) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error updating skill`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/skills/[id] — Delete a skill. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'skill-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteSkillContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    // Gated per skill by `performDeleteSkill`, same as PATCH above.
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteSkill({
      workspaceId,
      userId,
      skillId: id,
      source: 'api',
      request,
    })

    if (!result.success) {
      return v2SkillOrchestrationError(result.errorCode, result.error ?? 'Failed to delete skill')
    }

    return v2Data({ id, deleted: true as const }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting skill`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
