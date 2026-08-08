import { createCopilotWorkspaceUseCaseExecutor } from '@/lib/copilot/application/execute-workspace-use-case'
import { SKILL_DELEGATION_AUDIENCE } from '@/lib/skills/application/authorization'
import { skillOperations } from '@/lib/skills/application/operations'

export const executeCopilotSkillUseCase = createCopilotWorkspaceUseCaseExecutor({
  audience: SKILL_DELEGATION_AUDIENCE,
  operations: skillOperations,
})
