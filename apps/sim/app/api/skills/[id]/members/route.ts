import {
  listSkillMembersContract,
  removeSkillMemberContract,
  upsertSkillMemberContract,
} from '@/lib/api/contracts/skills'
import {
  createInternalResourceConcealmentPolicy,
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { skillOperations } from '@/lib/skills/application/operations'
import {
  grantSkillEditorUseCase,
  listSkillEditorsUseCase,
  revokeSkillEditorUseCase,
} from '@/lib/skills/application/use-cases'

const rateLimit = internalRateLimits.none({ reason: 'Preserve existing internal behavior' })
const errorPolicy = createInternalResourceConcealmentPolicy({
  base: internalOrchestrationErrorPolicy,
  notFoundMessage: 'Not found',
})

export const GET = defineInternalJsonRoute({
  contract: listSkillMembersContract,
  auth: internalSessionAuth,
  operation: skillOperations.listEditors,
  rateLimit,
  errorPolicy,
  mapInput: ({ params }) => ({
    skillId: params.id,
    sortBy: 'email' as const,
    sortOrder: 'asc' as const,
  }),
  useCase: listSkillEditorsUseCase,
  present: ({ editors }) => ({ editors }),
})

export const POST = defineInternalJsonRoute({
  contract: upsertSkillMemberContract,
  auth: internalSessionAuth,
  operation: skillOperations.grantEditor,
  rateLimit,
  errorPolicy,
  mapInput: ({ params, body }) => ({
    skillId: params.id,
    target: { kind: 'user_id' as const, userId: body.userId },
  }),
  useCase: grantSkillEditorUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!result.created || principal.kind !== 'session') return
    captureServerEvent(
      principal.userId,
      'skill_shared',
      { skill_id: input.skillId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  present: () => ({ success: true as const }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})

export const DELETE = defineInternalJsonRoute({
  contract: removeSkillMemberContract,
  auth: internalSessionAuth,
  operation: skillOperations.revokeEditor,
  rateLimit,
  errorPolicy,
  mapInput: ({ params, query }) => ({
    skillId: params.id,
    target: { kind: 'user_id' as const, userId: query.userId },
  }),
  useCase: revokeSkillEditorUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (principal.kind !== 'session') return
    captureServerEvent(
      principal.userId,
      'skill_unshared',
      { skill_id: input.skillId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  present: () => ({ success: true as const }),
})
