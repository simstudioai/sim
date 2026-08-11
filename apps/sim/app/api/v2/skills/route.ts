import { v2CreateSkillContract, v2ListSkillsContract } from '@/lib/api/contracts/v2/skills'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { skillOperations } from '@/lib/skills/application/operations'
import { createSkillUseCase, listSkillsUseCase } from '@/lib/skills/application/use-cases'
import { toV2Skill, toV2SkillSummary } from '@/app/api/v2/skills/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/skills — List skills in a workspace, built-ins included. */
export const GET = defineV2JsonRoute({
  contract: v2ListSkillsContract,
  operation: skillOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listSkillsUseCase,
  present: ({ skills }) => ({ data: skills.map(toV2SkillSummary), nextCursor: null }),
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
    if (principal.kind !== 'personal_api_key') return
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
