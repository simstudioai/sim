import {
  type Principal,
  requirePrincipalSubjectUserId,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import {
  releaseExecutionSlot,
  reserveExecutionSlot,
} from '@/lib/billing/calculations/usage-reservation'
import { resolveBillingAttribution } from '@/lib/billing/core/attribution'
import { checkExecutionUsageLimits } from '@/lib/billing/core/usage-gate-cache'
import { getExecutionTimeout, RESERVATION_TTL_BUFFER_MS } from '@/lib/core/execution-limits/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveTriggerExecution } from '@/lib/workflows/application/run-workflow-from-copilot'
import { type SideEffectsSummary, WriteStubPolicy } from '@/lib/workflows/dry-run'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import type { ExecutionTestHooks } from '@/executor/execution/types'
import type { ExecutionResult } from '@/executor/types'
import { attachAttemptedExecutionId } from '@/executor/utils/errors'
import { TEST_TRIGGER } from '@/stores/logs/filters/types'

const logger = createLogger('RunWorkflowForTest')

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
  /** What the run did with the writes it reached, once it ends, failed runs included. */
  onSideEffects: (executionId: string, sideEffects: SideEffectsSummary) => void
}

/**
 * One workflow run inside a workflow test: the workflow's single runnable trigger, the
 * test's input, and its mocks installed as executor test hooks. A write the test does not mock
 * is not sent: as in a dry run, it is answered with a placeholder shaped like the tool's output,
 * a `fetch` the workflow's code makes with any method but GET, HEAD or OPTIONS gets an empty 200,
 * and a Human in the loop or Wait block is answered whole, so the run never pauses. Billed and
 * logged like any run, under the `test` trigger.
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
  const principal = requireTestPrincipal(input.principal)
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
  // A suite outlives the request that started it, so a ban mid-suite stops the next run.
  if ((await getActivelyBannedUserIds([actorUserId])).length > 0) {
    throw new OrchestrationError('forbidden', 'This account is suspended')
  }
  const executionId = generateId()
  const billingAttribution = await resolveBillingAttribution({
    actorUserId,
    workspaceId: context.workspaceId,
  })
  const usage = await checkExecutionUsageLimits(billingAttribution)
  if (usage.isExceeded) {
    throw new OrchestrationError('forbidden', usage.message ?? 'Usage limit exceeded')
  }
  if (usage.payerUsage) {
    const plan = billingAttribution.payerSubscription?.plan
    const reservation = await reserveExecutionSlot({
      billingEntity: billingAttribution.billingEntity,
      reservationId: executionId,
      plan,
      enterpriseConcurrencyLimit: billingAttribution.payerSubscription?.enterpriseConcurrencyLimit,
      currentUsage: usage.payerUsage.currentUsage,
      limit: usage.payerUsage.limit,
      expiresAt: Date.now() + getExecutionTimeout(plan, 'sync') + RESERVATION_TTL_BUFFER_MS,
      ...(billingAttribution.organizationId &&
      usage.memberUsage?.limit !== null &&
      usage.memberUsage?.limit !== undefined
        ? {
            member: {
              organizationId: billingAttribution.organizationId,
              actorUserId: billingAttribution.actorUserId,
              currentUsage: usage.memberUsage.currentUsage,
              limit: usage.memberUsage.limit,
            },
          }
        : {}),
    })
    if (!reservation.reserved) {
      throw new OrchestrationError(
        'forbidden',
        `The workflow cannot start now (${reservation.reason}); wait for running executions to finish`
      )
    }
  }
  const sideEffects = new WriteStubPolicy({ workflowId: context.workflowId })
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
        workflowTriggerType: TEST_TRIGGER,
        enforceCredentialAccess: true,
        triggerBlockId: prepared.triggerBlockId,
        abortSignal: input.abortSignal,
        billingAttribution,
        testHooks: input.testHooks,
        sideEffects,
      },
      executionId
    )
    return { executionId, result }
  } catch (error) {
    attachAttemptedExecutionId(error, executionId)
    throw error
  } finally {
    await releaseExecutionSlot(executionId)
    try {
      input.onSideEffects(executionId, sideEffects.summary())
    } catch (error) {
      logger.warn('Recording a test run’s side effects failed', {
        executionId,
        error: getErrorMessage(error),
      })
    }
  }
}

/** The principal kinds `workflow_tests.run` admits; anything else reaching here is a wiring bug. */
function requireTestPrincipal(principal: Principal): WorkflowExecutionPrincipal {
  if (
    principal.kind === 'session' ||
    principal.kind === 'personal_api_key' ||
    principal.kind === 'oauth_access_token'
  ) {
    return principal
  }
  if (principal.kind === 'delegated' && principal.serviceId === 'copilot') return principal
  throw new Error(`A ${principal.kind} principal cannot run workflow tests`)
}
