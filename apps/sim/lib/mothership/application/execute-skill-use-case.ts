import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'
import { skillDelegationPolicy } from '@/lib/skills/application/authorization'
import { skillOperations } from '@/lib/skills/application/operations'

export const executeCopilotSkillUseCase = createCopilotApplicationAdapter({
  domain: 'skill',
  delegation: {
    audience: skillDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: skillOperations,
})
