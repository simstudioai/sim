import { v2CreateSkillContract, v2ListSkillsContract } from '@/lib/api/contracts/v2/skills'
import { performCreateSkill } from '@/lib/skills/orchestration'
import { listSkills } from '@/lib/workflows/skills/operations'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2CursorList, v2Data, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { toV2Skill, toV2SkillSummary, v2SkillOrchestrationError } from '@/app/api/v2/skills/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/skills — List skills in a workspace, built-ins included. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListSkillsContract,
  rateLimitEndpoint: 'skills',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, search, sortBy, sortOrder } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const skills = await listSkills({ workspaceId, search, sort: { sortBy, sortOrder } })

    // The per-workspace skill set is small and bounded → a single full page.
    return v2CursorList(skills.map(toV2SkillSummary), null, { rateLimit })
  },
})

/** POST /api/v2/skills — Create a skill. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateSkillContract,
  rateLimitEndpoint: 'skills',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { workspaceId, name, description, content } = input.body

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
  },
})
