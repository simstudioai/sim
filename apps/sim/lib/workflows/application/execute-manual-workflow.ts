import { requirePrincipalSubjectUserId, type WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import type { ExecuteWorkflowInput } from '@/lib/workflows/application/execute-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ExecuteWorkflowServiceResult,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'
import { getExecutionStateForWorkflow } from '@/lib/workflows/executor/execution-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  resolveTriggerRunOptions,
  validateTriggerInput,
} from '@/lib/workflows/triggers/run-options'

interface ManualExecutionInput
  extends Omit<ExecuteWorkflowInput, 'input' | 'mode' | 'requestedTimeoutSeconds'> {
  input?: unknown
  mode: 'sync' | 'stream' | 'sync-result-stream'
}

export interface ExecuteManualWorkflowInput extends ManualExecutionInput {
  triggerBlockId?: string
  useMockPayload: boolean
}

export interface ExecuteManualWorkflowFromBlockInput extends ManualExecutionInput {
  blockId: string
  sourceRunId: string
}

function resolveContext<I extends ManualExecutionInput>({ input }: { input: I }) {
  return resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId })
}

async function loadManualState(workflowId: string) {
  const state = await loadWorkflowFromNormalizedTables(workflowId)
  if (!state) {
    throw new OrchestrationError(
      'validation',
      `Workflow ${workflowId} has no saved state to run manually.`
    )
  }
  return state
}

function listTriggers(options: ReturnType<typeof resolveTriggerRunOptions>): string {
  return options.map((option) => `${option.triggerBlockId} (${option.blockName})`).join(', ')
}

function executionServiceInput(params: {
  principal: WorkflowExecutionPrincipal
  context: Awaited<ReturnType<typeof resolveActiveWorkflowApplicationContext>>
  input: ManualExecutionInput
}) {
  return {
    workflowId: params.context.workflowId,
    principal: params.principal,
    userId: requirePrincipalSubjectUserId(params.principal),
    requestId: params.input.requestId,
    executionId: params.input.executionId,
    callChain: params.input.callChain,
    useAuthenticatedUserAsActor: true,
    workflowRecord: params.context.workflow,
    includeFileBase64: params.input.includeFileBase64,
    base64MaxBytes: params.input.base64MaxBytes,
    selectedOutputs: params.input.selectedOutputs,
    rateLimitCounter: 'sync' as const,
    abortSignal: params.input.abortSignal,
    mode: params.input.mode,
    requestHeaders: params.input.requestHeaders,
    includeThinking: params.input.includeThinking,
    includeToolCalls: params.input.includeToolCalls,
    triggerType: 'manual' as const,
    useDraftState: true,
  }
}

export const executeManualWorkflowOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.executeManual,
  resolveContext: resolveContext<ExecuteManualWorkflowInput>,
  async execute({ principal, context, input }): Promise<ExecuteWorkflowServiceResult> {
    if (input.useMockPayload && input.input !== undefined) {
      throw new OrchestrationError(
        'validation',
        'input and run.entry.useMockPayload cannot be combined'
      )
    }
    const state = await loadManualState(context.workflowId)
    const options = resolveTriggerRunOptions(
      mergeSubblockStateWithValues(state.blocks),
      state.edges
    )
    if (options.length === 0) {
      throw new OrchestrationError(
        'validation',
        'No runnable trigger found. Add a Start/API/Input/Chat trigger or an external (webhook/integration) trigger before running manually.'
      )
    }

    let selected = options[0]
    if (input.triggerBlockId) {
      const explicit = options.find((option) => option.triggerBlockId === input.triggerBlockId)
      if (!explicit) {
        throw new OrchestrationError(
          'validation',
          `run.entry.blockId "${input.triggerBlockId}" is not a runnable trigger in the saved workflow. Valid triggers: ${listTriggers(options)}.`
        )
      }
      selected = explicit
    } else if (options.length > 1) {
      throw new OrchestrationError(
        'validation',
        `This workflow has multiple runnable triggers. Pass run.entry.blockId to choose one: ${listTriggers(options)}.`
      )
    }

    const executionInput = input.useMockPayload ? selected.mockPayload : input.input
    const validation = validateTriggerInput(selected, executionInput)
    if (!validation.ok) {
      if (!validation.error) throw new Error('Trigger input validation failed without an error')
      throw new OrchestrationError('validation', validation.error)
    }

    return executeWorkflowService({
      ...executionServiceInput({ principal, context, input }),
      input: executionInput,
      triggerBlockId: selected.triggerBlockId,
    })
  },
})

export const executeManualWorkflowFromBlockOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.executeManualFromBlock,
  resolveContext: resolveContext<ExecuteManualWorkflowFromBlockInput>,
  async execute({ principal, context, input }): Promise<ExecuteWorkflowServiceResult> {
    const state = await loadManualState(context.workflowId)
    if (!Object.hasOwn(state.blocks, input.blockId)) {
      throw new OrchestrationError(
        'validation',
        `run.entry.blockId "${input.blockId}" is not a block in the current saved workflow.`
      )
    }

    const sourceSnapshot = await getExecutionStateForWorkflow(input.sourceRunId, context.workflowId)
    if (!sourceSnapshot) {
      throw new OrchestrationError(
        'not_found',
        `No execution state found for source run "${input.sourceRunId}" in this workflow.`
      )
    }

    return executeWorkflowService({
      ...executionServiceInput({ principal, context, input }),
      input: input.input,
      runFromBlock: {
        startBlockId: input.blockId,
        sourceSnapshot,
        sourceExecutionId: input.sourceRunId,
      },
    })
  },
})
