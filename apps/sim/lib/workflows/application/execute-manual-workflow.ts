import { requirePrincipalSubjectUserId, type WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { formatQuotedNameList } from '@sim/utils/string'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { isWorkflowBlockProtected, normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  inlinesRunFiles,
  withholdUnadmittedInlineFiles,
} from '@/lib/workflows/application/admit-run-files'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import type { ExecuteWorkflowInput } from '@/lib/workflows/application/execute-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { PAUSING_BLOCK_TYPES, runsAnotherWorkflow, WriteStubPolicy } from '@/lib/workflows/dry-run'
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
import { TEST_TRIGGER } from '@/stores/logs/filters/types'

interface ManualExecutionInput extends Omit<ExecuteWorkflowInput, 'input' | 'mode'> {
  input?: unknown
  mode: 'sync' | 'stream' | 'sync-result-stream'
  stopAfterBlockId?: string
  /** Answer writes with placeholders and return what each would have sent (`run.dry`). */
  dry?: boolean
  /** Blocks, by selector, whose writes a dry run sends for real (`run.allowBlocks`). */
  allowBlocks?: string[]
  /** Block selector to the output that answers the block in a dry run (`run.mocks`). */
  mocks?: Record<string, Record<string, unknown>>
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

/** At most this many block names are listed when a block selector matches none. */
const MAX_LISTED_BLOCKS = 25

/** `"name" (id)` for each block of `ids`, at most {@link MAX_LISTED_BLOCKS} of them. */
function listBlocks(state: ManualWorkflowState, ids: string[]): string {
  return formatQuotedNameList(
    ids,
    MAX_LISTED_BLOCKS,
    (id) => `"${state.blocks[id]?.name ?? id}" (${id})`
  )
}

/**
 * The id of the saved block `selector` names: its id, else the one block whose display name or
 * reference key (the name lowercased, whitespace and dots removed: "Score lead" and `scorelead`)
 * matches it. A selector matching no block, or several, is refused with the candidates, so a
 * caller never has to read block ids out of the stored workflow. `field` names the wire field.
 */
function resolveBlockSelector(state: ManualWorkflowState, selector: string, field: string): string {
  if (Object.hasOwn(state.blocks, selector)) return selector
  const key = normalizeWorkflowBlockName(selector)
  const matches = Object.keys(state.blocks).filter((id) => {
    const name = state.blocks[id]?.name
    return typeof name === 'string' && normalizeWorkflowBlockName(name) === key
  })
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new OrchestrationError(
      'validation',
      `${field} "${selector}" names ${matches.length} blocks: ${listBlocks(state, matches)}. Pass one of their ids.`
    )
  }
  throw new OrchestrationError(
    'validation',
    `${field} "${selector}" is not a block in the current saved workflow. Pass a block's id, name or key: ${listBlocks(state, Object.keys(state.blocks))}.`
  )
}

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
  const blockId = resolveBlockSelector(state, selector, 'run.stopAfterBlockId')
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

/**
 * The dry run a manual run asked for, its allowed and mocked blocks resolved like
 * {@link resolveBlockSelector}. A dry run is logged under the `test` trigger, never as a manual
 * run, and returns its side effects with the result it waits for, so it cannot stream or detach.
 * Mocks need a dry run: a fixed output must never drive a run's real writes. A mock is data: it
 * never carries an executor control field (`_pauseMetadata`, any `_` field), and never replaces a
 * locked block, whose configured behaviour only an admin may change.
 */
function resolveRunOverrides(
  state: ManualWorkflowState,
  input: ManualExecutionInput,
  workflowId: string
) {
  if (!input.dry) {
    if (input.allowBlocks?.length) {
      throw new OrchestrationError('validation', 'run.allowBlocks requires run.dry')
    }
    if (input.mocks && Object.keys(input.mocks).length > 0) {
      throw new OrchestrationError(
        'validation',
        'run.mocks requires run.dry: a mocked block must never steer a run that sends its writes'
      )
    }
    return { triggerType: 'manual' as const }
  }
  if (input.mode === 'stream' || input.detachable) {
    throw new OrchestrationError(
      'validation',
      'run.dry returns its side effects with the run result, so it cannot be combined with stream or waitTimeoutSeconds'
    )
  }
  const allowBlockIds = new Set<string>()
  for (const selector of input.allowBlocks ?? []) {
    const blockId = resolveBlockSelector(state, selector, 'run.allowBlocks')
    const blockType = state.blocks[blockId].type
    if (PAUSING_BLOCK_TYPES.has(blockType)) {
      throw new OrchestrationError(
        'validation',
        `run.allowBlocks "${selector}" pauses the run, which would resume without the dry run; mock its output with run.mocks instead.`
      )
    }
    if (runsAnotherWorkflow(blockType)) {
      throw new OrchestrationError(
        'validation',
        `run.allowBlocks "${selector}" runs another workflow (a Workflow or custom block), whose writes a dry run never sends; mock its output with run.mocks instead.`
      )
    }
    allowBlockIds.add(blockId)
  }
  const blockMocks = new Map<string, Record<string, unknown>>()
  for (const [selector, output] of Object.entries(input.mocks ?? {})) {
    const blockId = resolveBlockSelector(state, selector, 'run.mocks')
    if (blockMocks.has(blockId)) {
      throw new OrchestrationError('validation', `run.mocks names block "${blockId}" twice`)
    }
    if (isWorkflowBlockProtected(blockId, state.blocks)) {
      throw new OrchestrationError(
        'validation',
        `run.mocks "${selector}" is a locked block (or inside a locked loop or parallel); its configured behaviour cannot be replaced.`
      )
    }
    const controlFields = Object.keys(output).filter((field) => field.startsWith('_'))
    if (controlFields.length > 0) {
      throw new OrchestrationError(
        'validation',
        `run.mocks "${selector}" sets ${controlFields.join(', ')}: fields starting with "_" control the run's execution, so a mock cannot set them.`
      )
    }
    blockMocks.set(blockId, output)
  }
  return {
    triggerType: TEST_TRIGGER,
    sideEffectPolicy: new WriteStubPolicy({ workflowId, allowBlockIds, blockMocks }),
  }
}

function listTriggers(options: ReturnType<typeof resolveTriggerRunOptions>): string {
  return options.map((option) => `${option.triggerBlockId} (${option.blockName})`).join(', ')
}

function executionServiceInput(params: {
  principal: WorkflowExecutionPrincipal
  context: Awaited<ReturnType<typeof resolveActiveWorkflowApplicationContext>>
  input: ManualExecutionInput
  draftState: NormalizedWorkflowData
  /** The resolved id of the block to stop after, never the caller's raw selector. */
  stopAfterBlockId: string | undefined
}) {
  return {
    ...resolveRunOverrides(params.draftState, params.input, params.context.workflowId),
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
      ...executionServiceInput({ principal, context, input, draftState: state, stopAfterBlockId }),
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
    const blockId = resolveBlockSelector(state, input.blockId, 'run.entry.blockId')
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
      ...executionServiceInput({ principal, context, input, draftState: state, stopAfterBlockId }),
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
