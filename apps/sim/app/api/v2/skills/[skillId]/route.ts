import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2DeleteSkillContract,
  v2GetSkillContract,
  v2UpdateSkillContract,
} from '@/lib/api/contracts/v2/skills'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { skillOperations } from '@/lib/skills/application/operations'
import {
  deleteSkillUseCase,
  getSkillUseCase,
  updateSkillUseCase,
} from '@/lib/skills/application/use-cases'
import { toV2Skill } from '@/app/api/v2/skills/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const skillResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Skill not found',
})

/** GET /api/v2/skills/[skillId] — Fetch a single skill, including its body. */
export const GET = defineV2JsonRoute({
  contract: v2GetSkillContract,
  operation: skillOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: skillResourceErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: query.workspaceId, skillId: params.skillId }),
  useCase: getSkillUseCase,
  present: ({ skill }) => ({ data: toV2Skill(skill) }),
})

/** PATCH /api/v2/skills/[skillId] — Update a skill. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateSkillContract,
  operation: skillOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: skillResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    skillId: params.skillId,
    source: 'api' as const,
  }),
  useCase: updateSkillUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'skill_updated',
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

/** DELETE /api/v2/skills/[skillId] — Delete a skill. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteSkillContract,
  operation: skillOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: skillResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    skillId: params.skillId,
    source: 'api' as const,
  }),
  useCase: deleteSkillUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'skill_deleted',
      {
        skill_id: result.skill.id,
        workspace_id: input.workspaceId,
        source: 'api',
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ skill }) => ({ data: { id: skill.id, deleted: true as const } }),
})
