import { createLogger } from '@sim/logger'
import { filterUndefined, isPlainRecord, isRecordLike } from '@sim/utils/object'
import { createCopilotWorkspaceApiKey } from '@/lib/api-key/application/create-api-key'
import { PlatformEvents } from '@/lib/core/telemetry'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { executeCopilotApiKeyUseCase } from '@/lib/mothership/application/execute-api-key-use-case'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/mothership/application/execute-workflow-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/mothership/request/types'
import {
  TOOL_EFFECT_PHASE,
  type ToolCallEffect,
  type ToolEffectPhase,
} from '@/lib/mothership/tool-executor/types'
import type {
  CancelWorkflowRunParams,
  CreateWorkflowParams,
  GenerateApiKeyParams,
  MoveWorkflowParams,
  RenameWorkflowParams,
  RunBlockParams,
  RunFromBlockParams,
  RunWorkflowParams,
  RunWorkflowUntilBlockParams,
  SetBlockEnabledParams,
  SetGlobalWorkflowVariablesParams,
  VariableOperation,
} from '@/lib/mothership/tools/handlers/param-types'
import { requireCopilotWorkspace } from '@/lib/mothership/tools/server/workspace-scope'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/mothership/vfs/path-utils'
import { cancelWorkflowRun } from '@/lib/workflows/application/cancel-run'
import { createWorkflow } from '@/lib/workflows/application/create-workflow'
import { moveWorkflowsBulk } from '@/lib/workflows/application/move-workflows-bulk'
import {
  runBlockFromCopilot,
  runFromBlockFromCopilot,
  runWorkflowFromCopilot,
  runWorkflowUntilBlockFromCopilot,
} from '@/lib/workflows/application/run-workflow-from-copilot'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'
import {
  applyWorkflowVariableOperations,
  setWorkflowBlockEnabled,
} from '@/lib/workflows/application/update-workflow-content'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { hasExecutionResult, readAttemptedExecutionId } from '@/executor/utils/errors'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowMutations')

/** Above this a Function block's `input.code` is echoed upstream JSON, not code worth reading. */
const LOG_CODE_INPUT_MAX_CHARS = 240
/** Any other echoed input string over this is data the caller already has, or can fetch. */
const LOG_INPUT_STRING_MAX_CHARS = 2_000
const LOG_INPUT_KEEP_CHARS = 200

/**
 * Compacts the block inputs echoed back in `logs`. A Function block's `input.code` embeds the
 * fully serialized upstream rows, so a seven-block run repeated the same rows several times
 * across ~14k chars of tool result. Outputs are never touched — they are what the run was for —
 * and the full input stays one `logs get <executionId> --trace` away.
 */
function compactBlockLogInputs(logs: unknown, executionId: string | undefined): unknown {
  if (!Array.isArray(logs)) return logs
  const reference = executionId ?? '<executionId>'
  return logs.map((entry) => {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.input)) return entry
    const input: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry.input)) {
      const limit = key === 'code' ? LOG_CODE_INPUT_MAX_CHARS : LOG_INPUT_STRING_MAX_CHARS
      input[key] =
        typeof value === 'string' && value.length > limit
          ? `${value.slice(0, LOG_INPUT_KEEP_CHARS)} …[${value.length} chars, see logs get ${reference} --trace]`
          : value
    }
    return { ...entry, input }
  })
}

function stripBinaryFields(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripBinaryFields)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'base64') continue
    out[k] = stripBinaryFields(v)
  }
  return out
}

/**
 * States how far a run got, so the answer survives a result the egress boundary withholds.
 *
 * Without it a withheld run reduces to a bare success or an opaque failure and takes the
 * execution id with it, which is what left a caller unable to tell a rejected call from a
 * completed run — and with nothing to look either one up by.
 */
function executionEffect(phase: ToolEffectPhase, executionId?: string): ToolCallEffect {
  return { phase, ...(executionId ? { ids: { executionId } } : {}) }
}

/** A run refused on its own arguments, before anything could be created. */
function runRejected(error: string): ToolCallResult {
  return { success: false, error, effect: executionEffect(TOOL_EFFECT_PHASE.notAttempted) }
}

/**
 * The phase of a run whose result came back, from how that run ended.
 *
 * A result in hand means the executor reached a terminal state and recorded it, so the
 * caller can read the whole story by id — `performed`. Cancelled and paused stopped partway
 * and may have run every block, one, or none, which is exactly what `attempted` says.
 *
 * Deliberately does not separate "ran no blocks" from "ran some". Establishing that would
 * take a callback on every block of every execution in the product, and buys the caller
 * nothing it cannot get by resolving the id it was already handed.
 */
function settledPhase(status: ExecutionResultStatus): ToolEffectPhase {
  return status === 'cancelled' || status === 'paused'
    ? TOOL_EFFECT_PHASE.attempted
    : TOOL_EFFECT_PHASE.performed
}

type ExecutionResultStatus = 'completed' | 'paused' | 'cancelled' | undefined

/** `undefined`, `null`, or a keyless object: a run whose top-level output says nothing. */
function isEmptyOutput(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isPlainRecord(value) && Object.keys(value).length === 0)
  )
}

/**
 * The last executed block's output, for a run whose own `output` came back empty.
 *
 * run_block and run_workflow_until_block stop before any Response block, so the executor's
 * top-level `output` is `{}` while the block's result sits in the final log entry — which a
 * caller read as "the block produced nothing". `outputFrom` names the block it was lifted from.
 */
function lastBlockOutput(
  logs: unknown
): { output: unknown; outputFrom: Record<string, unknown> } | undefined {
  if (!Array.isArray(logs) || logs.length === 0) return undefined
  const last = logs[logs.length - 1]
  if (!isPlainRecord(last)) return undefined
  return {
    output: last.output,
    outputFrom: filterUndefined({ blockId: last.blockId, blockName: last.blockName }),
  }
}

function buildExecutionOutput(
  result: {
    success: boolean
    metadata?: { executionId?: string }
    output?: unknown
    logs?: unknown[]
    error?: string
    status?: ExecutionResultStatus
  },
  phase: ToolEffectPhase,
  extra?: Record<string, unknown>,
  select?: string[]
): ToolCallResult {
  const executionId = result.metadata?.executionId
  const output = stripBinaryFields(result.output)
  const logs = compactBlockLogInputs(stripBinaryFields(result.logs), executionId)
  const lifted = isEmptyOutput(output) ? lastBlockOutput(logs) : undefined
  // A caller that names the outputs it wants gets those and nothing else: a seven-block
  // run otherwise costs ~14K chars of logs to learn one headline.
  const selected =
    select && select.length > 0
      ? selectFromLogs(select, Array.isArray(logs) ? logs : [])
      : undefined
  return {
    success: result.success,
    output: {
      executionId,
      success: result.success,
      ...extra,
      output: lifted ? lifted.output : output,
      ...(lifted ? { outputFrom: lifted.outputFrom } : {}),
      ...(selected ? { selected, logsOmitted: true } : { logs }),
    },
    error: result.success ? undefined : result.error || 'Workflow execution failed',
    effect: executionEffect(phase, executionId),
  }
}

/** The executor's block-name rule: lowercase, whitespace and dots removed. */
function normalizeSelectorHead(value: string): string {
  return value.toLowerCase().replace(/[\s.]+/g, '')
}

/**
 * Resolves `blockName.path` selectors against the run's block logs (the last log per block
 * wins, so loop iterations settle on final state) — names or ids for the head, dotted
 * paths into that block's output. An unresolved selector is reported, never thrown.
 */
function selectFromLogs(selectors: string[], logs: unknown[]): Record<string, unknown> {
  const byHead = new Map<string, Record<string, unknown>>()
  for (const entry of logs) {
    if (!isRecordLike(entry)) continue
    const log = entry as Record<string, unknown>
    const output = isRecordLike(log.output) ? (log.output as Record<string, unknown>) : undefined
    if (!output) continue
    if (typeof log.blockId === 'string') byHead.set(log.blockId, output)
    if (typeof log.blockName === 'string') byHead.set(normalizeSelectorHead(log.blockName), output)
  }
  const selected: Record<string, unknown> = {}
  for (const selector of selectors) {
    const [head = '', ...path] = selector.split('.')
    const base = byHead.get(head) ?? byHead.get(normalizeSelectorHead(head))
    if (!base) {
      selected[selector] = { unresolved: `no executed block named "${head}"` }
      continue
    }
    let value: unknown = base
    for (const segment of path) {
      value = isRecordLike(value) ? (value as Record<string, unknown>)[segment] : undefined
    }
    selected[selector] =
      value === undefined ? { unresolved: `no "${path.join('.')}" on ${head}` } : value
  }
  return selected
}

function buildExecutionError(error: unknown): ToolCallResult {
  if (hasExecutionResult(error)) {
    return buildExecutionOutput(
      {
        ...error.executionResult,
        success: false,
        error: error.executionResult.error || 'Workflow execution failed',
      },
      settledPhase(error.executionResult.status)
    )
  }
  logger.error('Copilot workflow execution command failed', { error })
  /**
   * Only failures raised after dispatch carry the id, so its absence is the positive
   * statement that nothing was created rather than an admission of not knowing.
   */
  const attemptedExecutionId = readAttemptedExecutionId(error)
  return {
    success: false,
    error: messageForCopilotWorkflowError(error, 'Workflow execution failed'),
    effect: executionEffect(
      attemptedExecutionId ? TOOL_EFFECT_PHASE.attempted : TOOL_EFFECT_PHASE.notAttempted,
      attemptedExecutionId
    ),
  }
}

function resolveRunWorkflowInput(params: { workflow_input?: unknown; input?: unknown }): unknown {
  if (Object.hasOwn(params, 'workflow_input')) {
    return params.workflow_input
  }
  if (Object.hasOwn(params, 'input')) {
    return params.input
  }
  return undefined
}

function resolveRunTriggerBlockId(params: { triggerBlockId?: unknown }): string | undefined {
  return typeof params.triggerBlockId === 'string' && params.triggerBlockId.trim().length > 0
    ? params.triggerBlockId
    : undefined
}

function resolveInputFromExecutionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function copilotRunLifecycle(context: ExecutionContext) {
  return {
    billingAttribution: context.billingAttribution,
    resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
    abortSignal: context.abortSignal,
    // Present only when the request handler already claimed an execution id for
    // this tool call because it is running the workflow server-side.
    ...(context.boundWorkflowExecutionId && context.toolCallId
      ? {
          boundExecution: {
            executionId: context.boundWorkflowExecutionId,
            copilotToolCallId: context.toolCallId,
          },
        }
      : {}),
  }
}

function assertWorkflowMutationNotAborted(
  context: ExecutionContext,
  message = 'Request aborted before workflow mutation could be applied.'
): void {
  if (context.abortSignal?.aborted) {
    throw new Error(message)
  }
}

export async function executeCreateWorkflow(
  params: CreateWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'Workflow name must be 200 characters or less' }
    }
    const workspaceId = requireCopilotWorkspace(context, params?.workspaceId)

    const folderPath = typeof params?.folderPath === 'string' ? params.folderPath.trim() : ''
    const folderId =
      typeof params?.folderId === 'string' && params.folderId.trim() ? params.folderId.trim() : null
    let canonicalFolderPath: string | undefined
    if (folderPath) {
      const relativePath = workflowFolderRelativePath(folderPath)
      canonicalFolderPath = relativePath
        ? `/${encodeVfsPathSegments(decodeVfsPathSegments(relativePath))}`
        : '/'
    }

    assertWorkflowMutationNotAborted(context)

    const result = await executeCopilotWorkflowUseCase(context, createWorkflow, {
      workspaceId,
      name,
      ...(canonicalFolderPath !== undefined ? { folderPath: canonicalFolderPath } : { folderId }),
    })
    const copilotSanitizedWorkflowState = sanitizeForCopilot({
      blocks: result.normalizedState.blocks || {},
      edges: result.normalizedState.edges || [],
      loops: result.normalizedState.loops || {},
      parallels: result.normalizedState.parallels || {},
    } as WorkflowState)

    return {
      success: true,
      output: {
        workflowId: result.workflow.id,
        workflowName: result.workflow.name,
        workspaceId: result.workflow.workspaceId,
        folderId: result.workflow.folderId,
        ...(copilotSanitizedWorkflowState ? { copilotSanitizedWorkflowState } : {}),
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to create workflow'),
    }
  }
}

export async function executeRunWorkflow(
  params: RunWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return runRejected('workflowId is required')
    }

    const useDraftState = !params.useDeployedState
    const workflowInput = resolveRunWorkflowInput(params)
    const result = await executeCopilotWorkflowUseCase(context, runWorkflowFromCopilot, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      useDraftState,
      triggerBlockId: resolveRunTriggerBlockId(params),
      workflowInput,
      hasWorkflowInput: workflowInput !== undefined,
      useMockPayload: params.useMockPayload === true,
      inputFromExecutionId: resolveInputFromExecutionId(params.inputFromExecutionId),
      lifecycle: copilotRunLifecycle(context),
    })

    return buildExecutionOutput(result, settledPhase(result.status), undefined, params.select)
  } catch (error) {
    return buildExecutionError(error)
  }
}

export async function executeCancelWorkflowRun(
  params: CancelWorkflowRunParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const executionId = resolveInputFromExecutionId(params.executionId)
    if (!executionId) {
      return { success: false, error: 'executionId is required' }
    }

    assertWorkflowMutationNotAborted(
      context,
      'Request aborted before workflow run cancellation could be applied.'
    )
    const result = await executeCopilotWorkflowUseCase(context, cancelWorkflowRun, {
      runId: executionId,
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    })

    return {
      success: result.success,
      output: {
        workflowId: result.workflowId,
        executionId: result.executionId,
        durablyRecorded: result.durablyRecorded,
        locallyAborted: result.locallyAborted,
        pausedCancelled: result.pausedCancelled,
        reason: result.reason,
      },
      error: result.success ? undefined : 'Workflow run cancellation could not be completed',
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to cancel workflow run'),
    }
  }
}

export async function executeSetGlobalWorkflowVariables(
  params: SetGlobalWorkflowVariablesParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const operations: VariableOperation[] = Array.isArray(params.operations)
      ? params.operations
      : []

    assertWorkflowMutationNotAborted(context)
    const result = await executeCopilotWorkflowUseCase(context, applyWorkflowVariableOperations, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      operations,
    })

    return { success: true, output: { updated: result.updated } }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

export async function executeRenameWorkflow(
  params: RenameWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'Workflow name must be 200 characters or less' }
    }

    assertWorkflowMutationNotAborted(context)
    await executeCopilotWorkflowUseCase(context, updateWorkflow, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      name,
    })

    return { success: true, output: { workflowId, name } }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to rename workflow'),
    }
  }
}

export async function executeMoveWorkflow(
  params: MoveWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowIds = params.workflowIds
    if (!workflowIds || workflowIds.length === 0) {
      return { success: false, error: 'workflowIds is required' }
    }
    if (!context.workspaceId) {
      return { success: false, error: 'Workspace context is required' }
    }

    assertWorkflowMutationNotAborted(context)
    const result = await executeCopilotWorkflowUseCase(context, moveWorkflowsBulk, {
      workspaceId: context.workspaceId,
      workflowIds,
      folderId: params.folderId || null,
    })

    return {
      success: result.moved.length > 0,
      output: { moved: result.moved, failed: result.failed, folderId: result.folderId },
    }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

export async function executeRunWorkflowUntilBlock(
  params: RunWorkflowUntilBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return runRejected('workflowId is required')
    }
    if (!params.stopAfterBlockId) {
      return runRejected('stopAfterBlockId is required')
    }

    const useDraftState = !params.useDeployedState
    const workflowInput = resolveRunWorkflowInput(params)
    const result = await executeCopilotWorkflowUseCase(context, runWorkflowUntilBlockFromCopilot, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      useDraftState,
      triggerBlockId: resolveRunTriggerBlockId(params),
      workflowInput,
      hasWorkflowInput: workflowInput !== undefined,
      useMockPayload: params.useMockPayload === true,
      inputFromExecutionId: resolveInputFromExecutionId(params.inputFromExecutionId),
      stopAfterBlockId: params.stopAfterBlockId,
      lifecycle: copilotRunLifecycle(context),
    })

    return buildExecutionOutput(
      result,
      settledPhase(result.status),
      { stoppedAfterBlockId: params.stopAfterBlockId },
      params.select
    )
  } catch (error) {
    return buildExecutionError(error)
  }
}

export async function executeGenerateApiKey(
  params: GenerateApiKeyParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'API key name must be 200 characters or less' }
    }

    const workspaceId = requireCopilotWorkspace(context, params.workspaceId)
    assertWorkflowMutationNotAborted(context)

    const result = await executeCopilotApiKeyUseCase(context, createCopilotWorkspaceApiKey, {
      workspaceId,
      name,
    })
    try {
      PlatformEvents.apiKeyGenerated({ userId: context.userId, keyName: result.key.name })
    } catch (error) {
      logger.warn('Failed to capture Copilot API key analytics', { error })
    }

    return {
      success: true,
      output: {
        id: result.key.id,
        name: result.key.name,
        key: result.key.key,
        workspaceId,
        message: `API key "${result.key.name}" created. You did NOT receive the key value — Sim reveals it to the user ONLY through the secure, copyable chip it renders where you place a <credential>{"type":"sim_key"}</credential> tag, so you MUST emit that tag now or the user can never see the key (it cannot be shown again). Never print, guess, or fabricate a value. The key authenticates calls to deployed workflow endpoints via the x-api-key header.`,
      },
    }
  } catch (error) {
    logger.error('Copilot API key creation failed', { error })
    return {
      success: false,
      error: messageForCopilotApplicationError(error, 'Failed to create API key'),
    }
  }
}

export async function executeRunFromBlock(
  params: RunFromBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return runRejected('workflowId is required')
    }
    if (!params.startBlockId) {
      return runRejected('startBlockId is required')
    }

    const useDraftState = !params.useDeployedState
    const result = await executeCopilotWorkflowUseCase(context, runFromBlockFromCopilot, {
      workflowId,
      variableInputs: params.variableInputs,
      assertedWorkspaceId: context.workspaceId,
      useDraftState,
      blockId: params.startBlockId,
      workflowInput: resolveRunWorkflowInput(params),
      sourceExecutionId: params.executionId,
      lifecycle: copilotRunLifecycle(context),
    })

    return buildExecutionOutput(
      result,
      settledPhase(result.status),
      { startBlockId: params.startBlockId },
      params.select
    )
  } catch (error) {
    return buildExecutionError(error)
  }
}

export async function executeSetBlockEnabled(
  params: SetBlockEnabledParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!params.blockId) {
      return { success: false, error: 'blockId is required' }
    }
    if (typeof params.enabled !== 'boolean') {
      return { success: false, error: 'enabled must be a boolean' }
    }

    assertWorkflowMutationNotAborted(context)
    const result = await executeCopilotWorkflowUseCase(context, setWorkflowBlockEnabled, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      blockId: params.blockId,
      enabled: params.enabled,
    })

    return {
      success: true,
      output: {
        workflowId,
        workflowName: result.workflowName,
        blockId: params.blockId,
        enabled: params.enabled,
        affectedBlockIds: result.affectedBlockIds,
        copilotSanitizedWorkflowState: sanitizeForCopilot(result.state),
        ...(!result.changed
          ? {
              message: `Block ${params.blockId} is already ${params.enabled ? 'enabled' : 'disabled'}`,
            }
          : {}),
      },
    }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

/**
 * Strip the `workflows/` VFS prefix from a folder path, returning the
 * folder-relative remainder. `workflows` (or an empty path) maps to the
 * workspace root and yields an empty string.
 */
function workflowFolderRelativePath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed === 'workflows') return ''
  return trimmed.startsWith('workflows/') ? trimmed.slice('workflows/'.length) : trimmed
}

export async function executeRunBlock(
  params: RunBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return runRejected('workflowId is required')
    }
    if (!params.blockId) {
      return runRejected('blockId is required')
    }

    const useDraftState = !params.useDeployedState
    const result = await executeCopilotWorkflowUseCase(context, runBlockFromCopilot, {
      workflowId,
      variableInputs: params.variableInputs,
      assertedWorkspaceId: context.workspaceId,
      useDraftState,
      blockId: params.blockId,
      workflowInput: resolveRunWorkflowInput(params),
      sourceExecutionId: params.executionId,
      lifecycle: copilotRunLifecycle(context),
    })

    return buildExecutionOutput(
      result,
      settledPhase(result.status),
      { blockId: params.blockId },
      params.select
    )
  } catch (error) {
    return buildExecutionError(error)
  }
}
