import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { checkExecutionUsageLimits } from '@/lib/billing/core/usage-gate-cache'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveTriggerExecution } from '@/lib/workflows/application/run-workflow-from-copilot'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import type { ExecutionTestHooks } from '@/executor/execution/types'
import type { ExecutionResult } from '@/executor/types'
import { attachAttemptedExecutionId } from '@/executor/utils/errors'

export type WorkflowTestVersion = 'draft' | 'deployed'

export interface WorkflowTestRunResult {
  executionId: string
  result: ExecutionResult
}

export interface RunWorkflowForTestInput {
  principal: Principal
  workflowId: string
  /** The test's workspace; a workflow from any other workspace is not found. */
  workspaceId: string
  version: WorkflowTestVersion
  workflowInput: unknown
  /** The trigger to start from; omitted, the workflow's only runnable trigger. */
  triggerBlockId?: string
  testHooks: ExecutionTestHooks
  abortSignal: AbortSignal
}

/**
 * One workflow run inside a workflow test: the workflow's single runnable trigger, the
 * test's input, and its mocks installed as executor test hooks. Billed and logged like any
 * run, under the `test` trigger.
 *
 * A step of the `workflow_tests.run` operation, which authorized the caller's write access to
 * the workspace before any test ran; nothing else may call it. Each nested run is not
 * authorized again, so a delegated caller's token cannot lapse halfway through a suite.
 */
export async function runWorkflowForTest(
  input: RunWorkflowForTestInput
): Promise<WorkflowTestRunResult> {
  const context = await resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: input.workspaceId,
  })
  const principal = input.principal
  const useDraftState = input.version === 'draft'
  const prepared = await resolveTriggerExecution({
    input: {
      workflowId: input.workflowId,
      useDraftState,
      workflowInput: input.workflowInput,
      hasWorkflowInput: true,
      ...(input.triggerBlockId ? { triggerBlockId: input.triggerBlockId } : {}),
      useMockPayload: false,
    },
    workspaceId: context.workspaceId,
  })
  // actorless-unsupported: tests run only for session, personal-key, OAuth, or delegated principals; workflow_tests.run admits no executor or workspace-key caller.
  const actorUserId = requirePrincipalSubjectUserId(principal)
  const executionId = generateId()
  const billingAttribution = await resolveBillingAttribution({
    actorUserId,
    workspaceId: context.workspaceId,
  })
  const usage = await checkExecutionUsageLimits(billingAttribution)
  if (usage.isExceeded) {
    throw new OrchestrationError('forbidden', usage.message ?? 'Usage limit exceeded')
  }
  try {
    const result = await executeWorkflow(
      {
        id: context.workflowId,
        userId: context.workflow.userId,
        workspaceId: context.workspaceId,
        variables: context.workflow.variables || {},
      },
      generateRequestId(),
      prepared.input,
      actorUserId,
      {
        enabled: true,
        principal,
        useDraftState,
        workflowTriggerType: 'test',
        enforceCredentialAccess: true,
        triggerBlockId: prepared.triggerBlockId,
        abortSignal: input.abortSignal,
        billingAttribution,
        testHooks: input.testHooks,
      },
      executionId
    )
    return { executionId, result }
  } catch (error) {
    attachAttemptedExecutionId(error, executionId)
    throw error
  }
}
