import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { prepareWorkflowExecutionAdmission } from '@/lib/workflows/execution-admission'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import {
  getExecutionInputForWorkflow,
  getExecutionStateForWorkflow,
  getLatestExecutionStateWithExecutionId,
} from '@/lib/workflows/executor/execution-state'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'
import {
  resolveTriggerRunOptions,
  validateTriggerInput,
} from '@/lib/workflows/triggers/run-options'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionResult } from '@/executor/types'
import { attachAttemptedExecutionId, hasExecutionResult } from '@/executor/utils/errors'

const logger = createLogger('CopilotWorkflowRun')

import {
  emptyResolvedSecretTraceProvenance,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export interface CopilotWorkflowRunLifecycle {
  billingAttribution?: BillingAttributionSnapshot
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  abortSignal?: AbortSignal
  /**
   * Execution identity the caller already claimed for this Copilot tool call.
   *
   * Set only when the copilot request handler runs a workflow tool server-side
   * because no browser picked it up. Using the claimed id as the child
   * execution id — and stamping the matching trusted correlation — keeps a
   * server-run tool call as attributable in `workflow_execution_logs` as a
   * browser-routed one, which `/api/workflows/[id]/execute` does for its own
   * claim at the equivalent point.
   */
  boundExecution?: {
    executionId: string
    copilotToolCallId: string
  }
}

interface BaseCopilotRunInput {
  workflowId: string
  assertedWorkspaceId?: string
  useDraftState: boolean
  lifecycle: CopilotWorkflowRunLifecycle
}

interface TriggerCopilotRunInput extends BaseCopilotRunInput {
  triggerBlockId?: string
  workflowInput?: unknown
  hasWorkflowInput: boolean
  useMockPayload: boolean
  inputFromExecutionId?: string
}

export interface RunWorkflowFromCopilotInput extends TriggerCopilotRunInput {}

export interface RunWorkflowUntilBlockFromCopilotInput extends TriggerCopilotRunInput {
  stopAfterBlockId: string
}

interface SnapshotCopilotRunInput extends BaseCopilotRunInput {
  blockId: string
  workflowInput?: unknown
  sourceExecutionId?: string
}

export interface RunFromBlockFromCopilotInput extends SnapshotCopilotRunInput {}
export interface RunBlockFromCopilotInput extends SnapshotCopilotRunInput {}

function resolveContext<I extends BaseCopilotRunInput>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

async function loadDefinition(input: BaseCopilotRunInput, workspaceId: string) {
  if (input.useDraftState) return loadWorkflowFromNormalizedTables(input.workflowId)
  try {
    return await loadDeployedWorkflowState(input.workflowId, workspaceId)
  } catch (error) {
    if (error instanceof NoActiveDeploymentError) return null
    throw error
  }
}

async function resolveTriggerExecution(params: {
  input: TriggerCopilotRunInput
  workspaceId: string
}): Promise<{ triggerBlockId: string; input: unknown }> {
  const state = await loadDefinition(params.input, params.workspaceId)
  if (!state?.blocks) {
    throw new OrchestrationError(
      'validation',
      `Workflow ${params.input.workflowId} has no ${params.input.useDraftState ? 'saved draft' : 'deployed'} state to run.`
    )
  }
  const merged = mergeSubblockStateWithValues(state.blocks)
  const options = resolveTriggerRunOptions(merged, state.edges)
  if (options.length === 0) {
    throw new OrchestrationError(
      'validation',
      'No runnable trigger found. Add a Start/API/Input/Chat trigger or an external (webhook/integration) trigger before running.'
    )
  }
  const listTriggers = () =>
    options.map((option) => `${option.triggerBlockId} (${option.blockName})`).join(', ')
  let option = options[0]
  if (params.input.triggerBlockId) {
    const selected = options.find(
      (candidate) => candidate.triggerBlockId === params.input.triggerBlockId
    )
    if (!selected) {
      throw new OrchestrationError(
        'validation',
        `triggerBlockId "${params.input.triggerBlockId}" is not a runnable trigger in this workflow. Valid triggers: ${listTriggers()}. Call get_workflow_run_options to inspect them.`
      )
    }
    option = selected
  } else if (options.length > 1) {
    throw new OrchestrationError(
      'validation',
      `This workflow has multiple triggers — pass triggerBlockId to choose one: ${listTriggers()}. Call get_workflow_run_options for each trigger's input shape.`
    )
  }

  const sourceCount =
    (params.input.hasWorkflowInput ? 1 : 0) +
    (params.input.useMockPayload ? 1 : 0) +
    (params.input.inputFromExecutionId ? 1 : 0)
  if (sourceCount > 1) {
    throw new OrchestrationError(
      'validation',
      'Provide only one input source: workflow_input, useMockPayload: true, or inputFromExecutionId.'
    )
  }
  if (params.input.useMockPayload) {
    return { triggerBlockId: option.triggerBlockId, input: option.mockPayload }
  }

  let executionInput = params.input.workflowInput
  if (params.input.inputFromExecutionId) {
    const source = await getExecutionInputForWorkflow(
      params.input.inputFromExecutionId,
      params.input.workflowId
    )
    if (!source.found) {
      throw new OrchestrationError(
        'not_found',
        `No execution "${params.input.inputFromExecutionId}" found for this workflow to reuse input from.`
      )
    }
    if (source.input === undefined) {
      throw new OrchestrationError(
        'validation',
        `Execution "${params.input.inputFromExecutionId}" has no recorded input to reuse.`
      )
    }
    executionInput = source.input
  }
  const validation = validateTriggerInput(option, executionInput)
  if (!validation.ok) {
    throw new OrchestrationError(
      'validation',
      validation.error || 'workflow_input is invalid for the target trigger.'
    )
  }
  return { triggerBlockId: option.triggerBlockId, input: executionInput }
}

async function resolveSourceSnapshot(input: SnapshotCopilotRunInput): Promise<{
  executionId: string
  snapshot: SerializableExecutionState
}> {
  if (input.sourceExecutionId) {
    const snapshot = await getExecutionStateForWorkflow(input.sourceExecutionId, input.workflowId)
    if (snapshot) return { executionId: input.sourceExecutionId, snapshot }
    throw new OrchestrationError(
      'not_found',
      `No execution state found for execution ${input.sourceExecutionId}. Run the full workflow first.`
    )
  }
  const latest = await getLatestExecutionStateWithExecutionId(input.workflowId)
  if (latest?.state) return { executionId: latest.executionId, snapshot: latest.state }
  throw new OrchestrationError(
    'not_found',
    `No execution state found for workflow ${input.workflowId}. Run the full workflow first to create a snapshot.`
  )
}

async function executeCopilotRun(params: {
  principal: Principal
  input: BaseCopilotRunInput
  context: Awaited<ReturnType<typeof resolveActiveWorkflowApplicationContext>>
  executionInput: unknown
  triggerBlockId?: string
  stopAfterBlockId?: string
  runFromBlock?: {
    startBlockId: string
    sourceSnapshot: SerializableExecutionState
    sourceExecutionId: string
  }
}): Promise<ExecutionResult> {
  if (
    params.principal.kind === 'credential_group_enrollment' ||
    params.principal.kind === 'scim_connection' ||
    (params.principal.kind === 'delegated' && params.principal.serviceId === 'executor')
  ) {
    throw new Error('The principal cannot start a Copilot workflow execution')
  }
  const actorUserId = requirePrincipalSubjectUserId(params.principal)
  const boundExecution = params.input.lifecycle.boundExecution
  // Reuse the caller's already-claimed execution id so the claim and the log
  // row describe the same run; otherwise mint our own as before.
  const childExecutionId = boundExecution?.executionId ?? generateId()
  const requestId = generateRequestId()
  const admission = await prepareWorkflowExecutionAdmission(
    {
      userId: actorUserId,
      billingAttribution: params.input.lifecycle.billingAttribution,
    },
    params.context.workspaceId,
    childExecutionId
  )
  const registry = params.input.lifecycle.resolvedSecretTraceRegistry
  const trustedInitialResolvedSecretTraceProvenance = registry?.exportProvenanceForValue(
    params.executionInput
  )
  const completePendingActivation = registry?.beginPendingActivation()
  /**
   * The run's own result, once the executor returns it. The post-run crossing below is inside the
   * same `try`, so its failure reaches the catch carrying nothing — and on that evidence alone it
   * is indistinguishable from a run that never started. Holding the result here keeps the real
   * envelope available to describe content that certainly exists.
   */
  let runResult: ExecutionResult | undefined
  /**
   * The executor call is the first statement of this `try`, so everything caught below is
   * post-dispatch by construction, while authorization, admission and provenance export all
   * throw past this function having created nothing. That asymmetry is the whole of what a
   * caller needs: no id means nothing exists, an id means resolve it before retrying.
   *
   * Deliberately no finer. Establishing whether a particular block ran would take a callback
   * on every block of every execution in the product, to spare this one caller a lookup it
   * can already make with the id it was handed. Keep the executor call first: anything
   * inserted above it would be reported as a run that may exist.
   */
  try {
    const result = await executeWorkflow(
      {
        id: params.context.workflowId,
        userId: params.context.workflow.userId,
        workspaceId: params.context.workspaceId,
        variables: params.context.workflow.variables || {},
      },
      requestId,
      params.executionInput,
      actorUserId,
      {
        enabled: true,
        principal: params.principal,
        useDraftState: params.input.useDraftState,
        workflowTriggerType: 'copilot',
        /** `requirePrincipalSubjectUserId` above rejects every principal that cannot name a caller. */
        enforceCredentialAccess: true,
        triggerBlockId: params.triggerBlockId,
        stopAfterBlockId: params.stopAfterBlockId,
        runFromBlock: params.runFromBlock,
        abortSignal: params.input.lifecycle.abortSignal,
        billingAttribution: admission.billingAttribution,
        ...(trustedInitialResolvedSecretTraceProvenance
          ? { trustedInitialResolvedSecretTraceProvenance }
          : {}),
        ...(boundExecution
          ? {
              trustedExecutionCorrelation: {
                executionId: childExecutionId,
                requestId,
                source: 'workflow' as const,
                workflowId: params.context.workflowId,
                triggerType: 'copilot',
                copilotToolCallId: boundExecution.copilotToolCallId,
              },
            }
          : {}),
      },
      childExecutionId
    )
    runResult = result
    if (registry) {
      await registry.importCrossingProvenance(
        result.executionState?.resolvedSecretTraceProvenance,
        { output: result.output, logs: result.logs, error: result.error },
        { trusted: true, origin: 'copilotWorkflowMutation.runCrossing' }
      )
    }
    return result
  } catch (error) {
    /**
     * `executeWorkflow` names the run itself once it crosses its own dispatch boundary, so
     * preflight failures inside it correctly carry nothing. This covers only the window it
     * cannot see: a failure after the run already returned, where the crossing import is
     * what threw and an execution certainly exists.
     */
    attachAttemptedExecutionId(error, childExecutionId)
    /**
     * Recovery must never replace the failure it is describing. Both steps below run only to
     * record and release, and either throwing would propagate a different error — one the
     * dispatched-run id was never recorded against — so an existing run would report itself
     * as never started and invite the duplicate this id exists to prevent.
     */
    if (registry) {
      /**
       * Either source counts as proof a run exists: the error carries the result when the run or
       * its post-execution work threw, and `runResult` holds it when the failure came later still
       * — from the crossing below, after the executor had already returned.
       */
      const executionResult = hasExecutionResult(error) ? error.executionResult : runResult
      try {
        /**
         * Only a failure with no result from either source can claim nothing ran, and saying so
         * keeps the caller's failure reason instead of reducing the tool result to "result
         * unavailable" for a message that named no secret because none had been resolved yet.
         * Every other failure hands back the envelope it has, and an incomplete one still latches.
         */
        await registry.importCrossingProvenance(
          executionResult
            ? executionResult.executionState?.resolvedSecretTraceProvenance
            : emptyResolvedSecretTraceProvenance(),
          {
            output: executionResult?.output,
            logs: executionResult?.logs,
            error: executionResult?.error,
            thrownMessage: toError(error).message,
          },
          { trusted: true, origin: 'copilotWorkflowMutation.failedRunCrossing' }
        )
      } catch (importError) {
        logger.error('Failed to record provenance for a failed Copilot run', {
          executionId: childExecutionId,
          error: toError(importError).message,
        })
      }
    }
    if (admission.targetReservation) {
      try {
        await releaseExecutionSlot(childExecutionId)
      } catch (releaseError) {
        logger.error('Failed to release the execution slot for a failed Copilot run', {
          executionId: childExecutionId,
          error: toError(releaseError).message,
        })
      }
    }
    throw error
  } finally {
    completePendingActivation?.()
  }
}

function defineTriggerRunUseCase<I extends TriggerCopilotRunInput & { stopAfterBlockId?: string }>(
  operation:
    | typeof workflowOperations.runFromCopilot
    | typeof workflowOperations.runUntilFromCopilot
) {
  return defineAuthorizedWorkflowUseCase({
    operation,
    resolveContext: resolveContext<I>,
    async execute({ principal, input, context }) {
      const prepared = await resolveTriggerExecution({ input, workspaceId: context.workspaceId })
      return executeCopilotRun({
        principal,
        input,
        context,
        executionInput: prepared.input,
        triggerBlockId: prepared.triggerBlockId,
        stopAfterBlockId: input.stopAfterBlockId,
      })
    },
  })
}

export const runWorkflowFromCopilot = defineTriggerRunUseCase<RunWorkflowFromCopilotInput>(
  workflowOperations.runFromCopilot
)

export const runWorkflowUntilBlockFromCopilot =
  defineTriggerRunUseCase<RunWorkflowUntilBlockFromCopilotInput>(
    workflowOperations.runUntilFromCopilot
  )

function defineSnapshotRunUseCase<I extends SnapshotCopilotRunInput>(
  operation:
    | typeof workflowOperations.runFromBlockFromCopilot
    | typeof workflowOperations.runBlockFromCopilot,
  stopAtStartBlock: boolean
) {
  return defineAuthorizedWorkflowUseCase({
    operation,
    resolveContext: resolveContext<I>,
    async execute({ principal, input, context }) {
      const state = await loadDefinition(input, context.workspaceId)
      if (!state?.blocks) {
        throw new OrchestrationError(
          'validation',
          `Workflow ${input.workflowId} has no ${input.useDraftState ? 'saved draft' : 'deployed'} state to run.`
        )
      }
      const source = await resolveSourceSnapshot(input)
      return executeCopilotRun({
        principal,
        input,
        context,
        executionInput: input.workflowInput,
        runFromBlock: {
          startBlockId: input.blockId,
          sourceSnapshot: source.snapshot,
          sourceExecutionId: source.executionId,
        },
        stopAfterBlockId: stopAtStartBlock ? input.blockId : undefined,
      })
    },
  })
}

export const runFromBlockFromCopilot = defineSnapshotRunUseCase<RunFromBlockFromCopilotInput>(
  workflowOperations.runFromBlockFromCopilot,
  false
)

export const runBlockFromCopilot = defineSnapshotRunUseCase<RunBlockFromCopilotInput>(
  workflowOperations.runBlockFromCopilot,
  true
)
