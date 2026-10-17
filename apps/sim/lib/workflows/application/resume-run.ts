import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { withholdUnadmittedInlineFiles } from '@/lib/workflows/application/admit-run-files'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { executeResumeWorkflow } from '@/lib/workflows/executor/resume-execution'

export interface ResumeWorkflowRunInput {
  workflowId: string
  runId: string
  contextId: string
  resumeInput: unknown
  /** The caller's response contract: `legacy` may stream; `v2` answers JSON only. */
  surface: 'legacy' | 'v2'
}

export const resumeWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.resumeRun,
  resolveContext: ({ input }: { input: ResumeWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
    }),
  async execute({ principal, input, context, request }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await executeResumeWorkflow({
      workflowId: context.workflowId,
      executionId: context.runId,
      contextId: input.contextId,
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      resumeInput: input.resumeInput,
      isApiCaller: principal.kind !== 'session',
      pollingSurface: input.surface,
      allowStreaming: input.surface === 'legacy',
      requestSignal: request?.signal,
      requestHeaders: request?.headers,
    })
    /** A resumed run inlines its output files, which are admitted per file like a fresh run's. */
    return withholdUnadmittedInlineFiles(principal, context.workspaceId, result)
  },
})
