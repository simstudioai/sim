import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateSkillContract, v2ListSkillsContract } from '@/lib/api/contracts/v2/skills'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performCreateSkill } from '@/lib/skills/orchestration'
import { listSkills } from '@/lib/workflows/skills/operations'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toV2Skill, toV2SkillSummary, v2SkillOrchestrationError } from '@/app/api/v2/skills/utils'

const logger = createLogger('V2SkillsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/skills — List skills in a workspace, built-ins included. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'skills')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListSkillsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const skills = await listSkills({ workspaceId })

    // The per-workspace skill set is small and bounded → a single full page.
    return v2CursorList(skills.map(toV2SkillSummary), null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing skills`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/skills — Create a skill. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'skills')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateSkillContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, name, description, content } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performCreateSkill({
      workspaceId,
      userId,
      name,
      description,
      content,
      source: 'api',
      request,
    })

    if (!result.success || !result.skill) {
      return v2SkillOrchestrationError(result.errorCode, result.error ?? 'Failed to create skill')
    }

    return v2Data({ skill: toV2Skill(result.skill) }, { rateLimit, status: 201 })
  } catch (error) {
    logger.error(`[${requestId}] Error creating skill`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
