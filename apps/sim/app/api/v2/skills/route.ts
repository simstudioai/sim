import { isUserCredentialPrincipal } from '@sim/auth/principal'
import { v2CreateSkillContract, v2ListSkillsContract } from '@/lib/api/contracts/v2/skills'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { skillOperations } from '@/lib/skills/application/operations'
import { createSkillUseCase, listSkillsUseCase } from '@/lib/skills/application/use-cases'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'
import { toV2Skill, toV2SkillSummary } from '@/app/api/v2/skills/utils'

/** Every param that changes which skills, in which order, this list returns. */
function skillCursorFilters(query: { workspaceId: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListSkillsContract), {
    workspaceId: query.workspaceId,
    search: query.search,
  })
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/skills — List skills in a workspace, built-ins included. */
export const GET = defineV2JsonRoute({
  contract: v2ListSkillsContract,
  operation: skillOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => {
    /**
     * The offset counts positions in the merged, filtered, sorted sequence, so
     * every param that changes that sequence is stamped into the cursor and
     * re-checked here. `limit` is deliberately absent — it selects how much of
     * the sequence to return, not what the sequence is.
     */
    return {
      ...query,
      offset: decodeOffsetCursor(
        query.cursor,
        cursorSortKey(query.sortBy, query.sortOrder),
        skillCursorFilters(query)
      ),
    }
  },
  useCase: listSkillsUseCase,
  present: ({ skills, hasMore, offset, limit }, { query }) => ({
    data: skills.map(toV2SkillSummary),
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          skillCursorFilters(query),
          offset + limit
        )
      : null,
  }),
})

/** POST /api/v2/skills — Create a skill. */
export const POST = defineV2JsonRoute({
  contract: v2CreateSkillContract,
  operation: skillOperations.create,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ ...body, source: 'api' as const }),
  useCase: createSkillUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'skill_created',
      {
        skill_id: result.skill.id,
        skill_name: result.skill.name,
        workspace_id: input.workspaceId,
        source: 'api',
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ skill }) => ({ data: toV2Skill(skill) }),
})
