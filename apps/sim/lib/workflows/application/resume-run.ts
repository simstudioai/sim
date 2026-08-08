import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { executeResumeWorkflow } from '@/lib/workflows/executor/resume-execution'

export interface ResumeWorkflowRunInput {
  workflowId: string
  runId: string
  contextId: string
  resumeInput: unknown
}

function assertedWorkspaceId(principal: Principal): string | undefined {
  return principal.kind === 'workspace_api_key' || principal.kind === 'delegated'
    ? principal.workspaceId
    : undefined
}

export const resumeWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.resumeRun,
  resolveContext: ({ principal, input }: { principal: Principal; input: ResumeWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkspaceId(principal),
    }),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    return executeResumeWorkflow({
      workflowId: context.workflowId,
      executionId: context.runId,
      contextId: input.contextId,
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      resumeInput: input.resumeInput,
      isApiCaller: true,
      pollingSurface: 'v2',
      allowStreaming: false,
    })
  },
})
