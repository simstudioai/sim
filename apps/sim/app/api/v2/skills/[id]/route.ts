import {
  v2DeleteSkillContract,
  v2GetSkillContract,
  v2UpdateSkillContract,
} from '@/lib/api/contracts/v2/skills'
import { performDeleteSkill, performUpdateSkill } from '@/lib/skills/orchestration'
import { getSkillById } from '@/lib/workflows/skills/operations'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { toV2Skill, v2SkillOrchestrationError } from '@/app/api/v2/skills/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/skills/[id] — Fetch a single skill, including its body. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetSkillContract,
  rateLimitEndpoint: 'skill-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const skill = await getSkillById({ skillId: id, workspaceId })
    if (!skill) return v2Error('NOT_FOUND', 'Skill not found')

    return v2Data({ skill: toV2Skill(skill) }, { rateLimit })
  },
})

/** PATCH /api/v2/skills/[id] — Update a skill. Omitted fields keep their values. */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateSkillContract,
  rateLimitEndpoint: 'skill-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId, name, description, content } = input.body

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
  },
})

/** DELETE /api/v2/skills/[id] — Delete a skill. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteSkillContract,
  rateLimitEndpoint: 'skill-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId } = input.query

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
  },
})
