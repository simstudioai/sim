import { requirePrincipalSubjectUserId, type WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  inlinesRunFiles,
  withholdUnadmittedInlineFiles,
} from '@/lib/workflows/application/admit-run-files'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveBlockSelector } from '@/lib/workflows/application/block-selector'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import {
  type DryRunRequest,
  resolveRunOverrides,
} from '@/lib/workflows/application/dry-run-overrides'
import type { ExecuteWorkflowInput } from '@/lib/workflows/application/execute-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ExecuteWorkflowServiceResult,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'
import { getExecutionStateForWorkflow } from '@/lib/workflows/executor/execution-state'
import {
  loadWorkflowFromNormalizedTables,
  type NormalizedWorkflowData,
} from '@/lib/workflows/persistence/utils'
import {
  resolveTriggerRunOptions,
  validateTriggerInput,
} from '@/lib/workflows/triggers/run-options'

interface ManualExecutionInput extends Omit<ExecuteWorkflowInput, 'input' | 'mode'>, DryRunRequest {
  input?: unknown
  mode: 'sync' | 'stream' | 'sync-result-stream'
  stopAfterBlockId?: string
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

type ManualWorkflowState = Awaited<ReturnType<typeof loadManualState>>

/** Blocks a run entering at `entryBlockId` can reach; the executor skips disabled blocks. */
function reachableFrom(state: ManualWorkflowState, entryBlockId: string): Set<string> {
  const targetsBySource = new Map<string, string[]>()
  for (const edge of state.edges) {
    const targets = targetsBySource.get(edge.source) ?? []
    targets.push(edge.target)
    targetsBySource.set(edge.source, targets)
  }
  const reached = new Set([entryBlockId])
  const queue = [entryBlockId]
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const target of targetsBySource.get(next) ?? []) {
      if (reached.has(target) || state.blocks[target]?.enabled === false) continue
      reached.add(target)
      queue.push(target)
    }
  }
  return reached
}

/**
 * The id of the block a run stops after ({@link resolveBlockSelector}). The engine stops only
 * when it completes a node whose id equals the target, so
 * a target the run cannot reach would silently run everything after the entry:
 * an unknown or disabled block, a block upstream of the entry or only behind a
 * disabled one, or a block inside a loop or parallel (which would stop after its
 * first iteration or never). All are refused, matching the editor, which offers
 * "Run until block" only outside subflows.
 */
function resolveStopAfterBlock(
  state: ManualWorkflowState,
  selector: string | undefined,
  entryBlockId: string
): string | undefined {
  if (selector === undefined) return undefined
  const blockId = resolveBlockSelector(state.blocks, selector, 'run.stopAfterBlockId')
  const block = state.blocks[blockId]
  if (block.enabled === false) {
    throw new OrchestrationError(
      'validation',
      `run.stopAfterBlockId "${blockId}" is disabled, so the run never executes it.`
    )
  }
  if (block.data?.parentId) {
    throw new OrchestrationError(
      'validation',
      `run.stopAfterBlockId "${blockId}" is inside loop or parallel "${block.data.parentId}"; stop after that container instead.`
    )
  }
  if (!reachableFrom(state, entryBlockId).has(blockId)) {
    throw new OrchestrationError(
      'validation',
      `run.stopAfterBlockId "${blockId}" is not reachable from entry block "${entryBlockId}"; stop after the entry block or one downstream of it.`
    )
  }
  return blockId
}

function listTriggers(options: ReturnType<typeof resolveTriggerRunOptions>): string {
  return options.map((option) => `${option.triggerBlockId} (${option.blockName})`).join(', ')
}

async function executionServiceInput(params: {
  principal: WorkflowExecutionPrincipal
  context: Awaited<ReturnType<typeof resolveActiveWorkflowApplicationContext>>
  input: ManualExecutionInput
  draftState: NormalizedWorkflowData
  /** The resolved id of the block to stop after, never the caller's raw selector. */
  stopAfterBlockId: string | undefined
}) {
  return {
    ...(await resolveRunOverrides({
      principal: params.principal,
      workspaceId: params.context.workspaceId,
      workflow: params.context.workflow,
      blocks: params.draftState.blocks,
      mode: params.input.mode,
      detachable: params.input.detachable,
      request: params.input,
    })),
    workflowId: params.context.workflowId,
    principal: params.principal,
    userId: requirePrincipalSubjectUserId(params.principal),
    requestId: params.input.requestId,
    executionId: params.input.executionId,
    callChain: params.input.callChain,
    useAuthenticatedUserAsActor: true,
    workflowRecord: params.context.workflow,
    includeFileBase64: inlinesRunFiles(
      params.principal,
      params.input.includeFileBase64,
      params.input.mode
    ),
    base64MaxBytes: params.input.base64MaxBytes,
    selectedOutputs: params.input.selectedOutputs,
    stopAfterBlockId: params.stopAfterBlockId,
    rateLimitCounter: 'sync' as const,
    requestedTimeoutSeconds: params.input.requestedTimeoutSeconds,
    abortSignal: params.input.abortSignal,
    mode: params.input.mode,
    detachable: params.input.detachable,
    requestHeaders: params.input.requestHeaders,
    includeThinking: params.input.includeThinking,
    includeToolCalls: params.input.includeToolCalls,
    useDraftState: true,
    draftState: params.draftState,
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
    const options = resolveTriggerRunOptions(mergeSubblockStateWithValues(state.blocks))
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

    const stopAfterBlockId = resolveStopAfterBlock(
      state,
      input.stopAfterBlockId,
      selected.triggerBlockId
    )
    const executionInput = input.useMockPayload ? selected.mockPayload : input.input
    const validation = validateTriggerInput(selected, executionInput)
    if (!validation.ok) {
      if (!validation.error) throw new Error('Trigger input validation failed without an error')
      throw new OrchestrationError('validation', validation.error)
    }

    const result = await executeWorkflowService({
      ...(await executionServiceInput({
        principal,
        context,
        input,
        draftState: state,
        stopAfterBlockId,
      })),
      input: executionInput,
      triggerBlockId: selected.triggerBlockId,
    })
    return withholdUnadmittedInlineFiles(principal, context.workspaceId, result)
  },
})

export const executeManualWorkflowFromBlockOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.executeManualFromBlock,
  resolveContext: resolveContext<ExecuteManualWorkflowFromBlockInput>,
  async execute({ principal, context, input }): Promise<ExecuteWorkflowServiceResult> {
    const state = await loadManualState(context.workflowId)
    const blockId = resolveBlockSelector(state.blocks, input.blockId, 'run.entry.blockId')
    const stopAfterBlockId = resolveStopAfterBlock(state, input.stopAfterBlockId, blockId)

    const sourceSnapshot = await getExecutionStateForWorkflow(
      input.sourceRunId,
      context.workflowId,
      { allowTestRun: input.dry === true }
    )
    if (!sourceSnapshot) {
      throw new OrchestrationError(
        'not_found',
        `No execution state found for source run "${input.sourceRunId}" in this workflow.`
      )
    }

    const result = await executeWorkflowService({
      ...(await executionServiceInput({
        principal,
        context,
        input,
        draftState: state,
        stopAfterBlockId,
      })),
      input: input.input,
      runFromBlock: {
        startBlockId: blockId,
        sourceSnapshot,
        sourceExecutionId: input.sourceRunId,
      },
    })
    return withholdUnadmittedInlineFiles(principal, context.workspaceId, result)
  },
})
