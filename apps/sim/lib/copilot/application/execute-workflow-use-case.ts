import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createCopilotApplicationPrincipal,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import { workflowDelegationPolicy } from '@/lib/workflows/application/authorization'
import {
  type ResolveWorkflowOutputsInput,
  type ResolveWorkflowOutputsResult,
  resolveWorkflowOutputs,
} from '@/lib/workflows/application/resolve-workflow-outputs'

export type CopilotWorkflowDelegationContext = CopilotExecutionContext

const workflowDelegation = {
  audience: workflowDelegationPolicy.audience,
  ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createDelegationId: (context: Parameters<typeof createCopilotApplicationPrincipal>[0]) =>
    `copilot-tool:${context.toolCallId}`,
} as const

/** Resolves workflow output metadata through one fixed authorized Workflow command. */
export function executeCopilotResolveWorkflowOutputs(
  context: CopilotWorkflowDelegationContext | undefined,
  input: ResolveWorkflowOutputsInput
): Promise<ResolveWorkflowOutputsResult> {
  return resolveWorkflowOutputs.execute({
    principal: createCopilotApplicationPrincipal(
      requireTrustedCopilotExecutionContext(context),
      workflowDelegation
    ),
    input,
  })
}
