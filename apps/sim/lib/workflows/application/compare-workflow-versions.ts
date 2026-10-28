import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isJsonWithinByteLimit } from '@/lib/core/utils/bounded-json'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { generateWorkflowDiffSummary, omitPresentationChanges } from '@/lib/workflows/comparison'
import { redactWorkflowDiffSummary } from '@/lib/workflows/comparison/redact'
import { loadWorkflowComparisonVersions } from '@/lib/workflows/persistence/compare-versions'

const MAX_COMPARISON_RESULT_BYTES = 16 * 1024 * 1024

export interface CompareWorkflowVersionsInput {
  workflowId: string
  assertedWorkspaceId?: string
  base: number
  target: number
}

export const compareWorkflowVersions = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.compareVersions,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CompareWorkflowVersionsInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ context, input }) {
    const states = await loadWorkflowComparisonVersions(
      context.workflowId,
      context.workspaceId,
      input.base,
      input.target
    )
    const summary = omitPresentationChanges(generateWorkflowDiffSummary(states.target, states.base))
    const result = {
      workflowId: context.workflowId,
      base: input.base,
      target: input.target,
      diff: redactWorkflowDiffSummary(summary, states.base, states.target),
    }
    if (!isJsonWithinByteLimit(result, MAX_COMPARISON_RESULT_BYTES)) {
      throw new OrchestrationError(
        'payload_too_large',
        'Deployment comparison result exceeds the 16 MiB limit'
      )
    }
    return result
  },
})
