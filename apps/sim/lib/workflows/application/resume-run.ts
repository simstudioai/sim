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
  /**
   * The calling surface's response contract. `legacy` may answer with a stream
   * and polls async resumes by job id; `v2` answers JSON only, so a run that
   * would stream is queued, and its async job id is derived from the resume
   * entry so a retried dispatch is deduplicated.
   */
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
