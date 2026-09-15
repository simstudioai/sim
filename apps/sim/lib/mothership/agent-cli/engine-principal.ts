import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'

/** Select authority from a code-owned operation, never from command arguments. */
export function enginePrincipal(
  runtime: AgentCliRuntime,
  useCase: Pick<OperationUseCase<ApplicationOperation, unknown, unknown>, 'delegationAudience'>
) {
  if (!runtime.invocation) return runtime.principal
  if (!useCase.delegationAudience)
    throw new OrchestrationError('forbidden', 'Operation is unavailable through Mothership')
  const principal = createCopilotChatPrincipal(runtime.invocation, useCase.delegationAudience)
  markCopilotWorkspaceInvocation(principal)
  return principal
}
