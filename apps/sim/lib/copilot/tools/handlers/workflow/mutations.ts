import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { performCreateWorkspaceApiKey } from '@/lib/api-key/orchestration'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/copilot/application/execute-workflow-use-case'
import { prepareWorkflowExecutionAdmission } from '@/lib/copilot/request/tools/workflow-context'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  buildVfsFolderPathMap,
  decodeVfsPathSegments,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'
import { generateRequestId } from '@/lib/core/utils/request'
import { createWorkflow } from '@/lib/workflows/application/create-workflow'
import {
  prepareCopilotWorkflowRun,
  readWorkflowDefinition,
} from '@/lib/workflows/application/read-workflow-definition'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'
import {
  updateWorkflowState,
  updateWorkflowVariables,
} from '@/lib/workflows/application/update-workflow-content'
import { listWorkflowFolders } from '@/lib/workflows/application/workflow-folders'
import {
  type ExecuteWorkflowOptions,
  executeWorkflow,
  type WorkflowInfo,
} from '@/lib/workflows/executor/execute-workflow'
import { getExecutionInputForWorkflow } from '@/lib/workflows/executor/execution-state'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import {
  resolveTriggerRunOptions,
  validateTriggerInput,
} from '@/lib/workflows/triggers/run-options'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { ensureWorkspaceAccess, getDefaultWorkspaceId } from '../access'

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

function buildExecutionOutput(
  result: {
    success: boolean
    metadata?: { executionId?: string }
    output?: unknown
    logs?: unknown[]
    error?: string
  },
  extra?: Record<string, unknown>
): ToolCallResult {
  return {
    success: result.success,
    output: {
      executionId: result.metadata?.executionId,
      success: result.success,
      ...extra,
      output: stripBinaryFields(result.output),
      logs: stripBinaryFields(result.logs),
    },
    error: result.success ? undefined : result.error || 'Workflow execution failed',
  }
}

async function executeCopilotWorkflowTarget(params: {
  workflow: WorkflowInfo
  input: unknown
  context: ExecutionContext
  options: Omit<ExecuteWorkflowOptions, 'billingAttribution'>
}) {
  const childExecutionId = generateId()
  if (!params.workflow.workspaceId) {
    throw new Error(`Workflow ${params.workflow.id} has no workspaceId`)
  }
  const admission = await prepareWorkflowExecutionAdmission(
    params.context,
    params.workflow.workspaceId,
    childExecutionId
  )
  const trustedInitialResolvedSecretTraceProvenance =
    params.context.resolvedSecretTraceRegistry?.exportProvenanceForValue(params.input)
  const completePendingActivation =
    params.context.resolvedSecretTraceRegistry?.beginPendingActivation()

  try {
    const result = await executeWorkflow(
      params.workflow,
      generateRequestId(),
      params.input,
      params.context.userId,
      {
        ...params.options,
        billingAttribution: admission.billingAttribution,
        ...(trustedInitialResolvedSecretTraceProvenance
          ? { trustedInitialResolvedSecretTraceProvenance }
          : {}),
      },
      childExecutionId
    )
    if (params.context.resolvedSecretTraceRegistry) {
      await params.context.resolvedSecretTraceRegistry.importCrossingProvenance(
        result.executionState?.resolvedSecretTraceProvenance,
        { output: result.output, logs: result.logs, error: result.error },
        { trusted: true }
      )
    }
    return result
  } catch (error) {
    if (params.context.resolvedSecretTraceRegistry) {
      const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
      await params.context.resolvedSecretTraceRegistry.importCrossingProvenance(
        executionResult?.executionState?.resolvedSecretTraceProvenance,
        {
          output: executionResult?.output,
          logs: executionResult?.logs,
          error: executionResult?.error,
          thrownMessage: toError(error).message,
        },
        { trusted: true }
      )
    }
    if (admission.targetReservation) {
      await releaseExecutionSlot(childExecutionId)
    }
    throw error
  } finally {
    completePendingActivation?.()
  }
}

function buildExecutionError(error: unknown): ToolCallResult {
  const message = toError(error).message
  if (hasExecutionResult(error)) {
    return buildExecutionOutput({
      ...error.executionResult,
      success: false,
      error: error.executionResult.error || message,
    })
  }
  return { success: false, error: message }
}

async function prepareWorkflowRunForCopilot(
  context: ExecutionContext,
  input: Parameters<typeof prepareCopilotWorkflowRun.execute>[0]['input']
) {
  try {
    return await executeCopilotWorkflowUseCase(context, prepareCopilotWorkflowRun, input)
  } catch (error) {
    throw new Error(messageForCopilotWorkflowError(error, 'Workflow execution failed'))
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

interface PreparedTriggerRun {
  triggerBlockId: string
  input: unknown
}

/**
 * Resolves which trigger a copilot run targets and validates the input against
 * it. There are no fallbacks: an invalid trigger id, an ambiguous workflow, or
 * input that doesn't match the trigger's schema returns an error string so the
 * agent fixes it and retries. The resolved triggerBlockId is returned so the
 * caller pins the executed entry to the validated one.
 */
async function resolveValidatedTriggerRun(
  workflowId: string,
  useDraftState: boolean,
  state: Awaited<ReturnType<typeof prepareCopilotWorkflowRun.execute>>['state'],
  params: {
    triggerBlockId?: unknown
    workflow_input?: unknown
    input?: unknown
    useMockPayload?: unknown
    inputFromExecutionId?: unknown
  }
): Promise<PreparedTriggerRun | { error: string }> {
  if (!state?.blocks) {
    return {
      error: `Workflow ${workflowId} has no ${useDraftState ? 'saved draft' : 'deployed'} state to run.`,
    }
  }

  const merged = mergeSubblockStateWithValues(state.blocks)
  const options = resolveTriggerRunOptions(merged, state.edges)

  if (options.length === 0) {
    return {
      error:
        'No runnable trigger found. Add a Start/API/Input/Chat trigger or an external (webhook/integration) trigger before running.',
    }
  }

  const listTriggers = () =>
    options.map((option) => `${option.triggerBlockId} (${option.blockName})`).join(', ')

  const requestedId = resolveRunTriggerBlockId(params)
  let option = options[0]
  if (requestedId) {
    const match = options.find((o) => o.triggerBlockId === requestedId)
    if (!match) {
      return {
        error: `triggerBlockId "${requestedId}" is not a runnable trigger in this workflow. Valid triggers: ${listTriggers()}. Call get_workflow_run_options to inspect them.`,
      }
    }
    option = match
  } else if (options.length > 1) {
    return {
      error: `This workflow has multiple triggers — pass triggerBlockId to choose one: ${listTriggers()}. Call get_workflow_run_options for each trigger's input shape.`,
    }
  }

  const providedInput = resolveRunWorkflowInput(params)
  const hasProvidedInput = providedInput !== undefined
  const useMock = params.useMockPayload === true
  const fromExecutionId =
    typeof params.inputFromExecutionId === 'string' && params.inputFromExecutionId.trim().length > 0
      ? params.inputFromExecutionId.trim()
      : undefined

  const sourceCount = (hasProvidedInput ? 1 : 0) + (useMock ? 1 : 0) + (fromExecutionId ? 1 : 0)
  if (sourceCount > 1) {
    return {
      error:
        'Provide only one input source: workflow_input, useMockPayload: true, or inputFromExecutionId.',
    }
  }

  // Mock payload is generated to match the trigger, so it bypasses validation.
  if (useMock) {
    return { triggerBlockId: option.triggerBlockId, input: option.mockPayload }
  }

  let inputToValidate = providedInput
  if (fromExecutionId) {
    const past = await getExecutionInputForWorkflow(fromExecutionId, workflowId)
    if (!past.found) {
      return {
        error: `No execution "${fromExecutionId}" found for this workflow to reuse input from.`,
      }
    }
    if (past.input === undefined) {
      return { error: `Execution "${fromExecutionId}" has no recorded input to reuse.` }
    }
    inputToValidate = past.input
  }

  const validation = validateTriggerInput(option, inputToValidate)
  if (!validation.ok) {
    return { error: validation.error || 'workflow_input is invalid for the target trigger.' }
  }

  return { triggerBlockId: option.triggerBlockId, input: inputToValidate }
}

function isBlockProtected(blockId: string, blocksById: Record<string, BlockState>): boolean {
  const block = blocksById[blockId]
  if (!block) return false
  if (block.locked) return true

  const visited = new Set<string>()
  let parentId = block.data?.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    if (blocksById[parentId]?.locked) return true
    parentId = blocksById[parentId]?.data?.parentId
  }

  return false
}

function hasDisabledAncestor(blockId: string, blocksById: Record<string, BlockState>): boolean {
  const visited = new Set<string>()
  let parentId = blocksById[blockId]?.data?.parentId

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = blocksById[parentId]
    if (!parent) return false
    if (parent.enabled === false) return true
    parentId = parent.data?.parentId
  }

  return false
}

function findDescendants(containerId: string, blocksById: Record<string, BlockState>): string[] {
  const descendants: string[] = []
  const stack = [containerId]
  const visited = new Set<string>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)

    for (const [blockId, block] of Object.entries(blocksById)) {
      if (block.data?.parentId === current) {
        descendants.push(blockId)
        stack.push(blockId)
      }
    }
  }

  return descendants
}

import type {
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
} from '../param-types'

const logger = createLogger('WorkflowMutations')

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
    const workspaceId =
      params?.workspaceId || context.workspaceId || (await getDefaultWorkspaceId(context.userId))

    const folderPath = typeof params?.folderPath === 'string' ? params.folderPath.trim() : ''
    let folderId =
      typeof params?.folderId === 'string' && params.folderId.trim() ? params.folderId.trim() : null
    if (folderPath) {
      const relativePath = workflowFolderRelativePath(folderPath)
      if (!relativePath) {
        folderId = null
      } else {
        const target = resolveFolderIdByPath(
          folderPath,
          await loadFolderPathIndex(workspaceId, context)
        )
        if ('error' in target) return { success: false, error: target.error }
        folderId = target.folderId
      }
    }

    assertWorkflowMutationNotAborted(context)

    const result = await executeCopilotWorkflowUseCase(context, createWorkflow, {
      workspaceId,
      name,
      folderId,
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
      return { success: false, error: 'workflowId is required' }
    }

    const useDraftState = !params.useDeployedState
    const preparedWorkflow = await prepareWorkflowRunForCopilot(context, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      state: useDraftState ? 'draft' : 'deployed',
    })
    const workflowRecord = preparedWorkflow.workflow
    const prepared = await resolveValidatedTriggerRun(
      workflowId,
      useDraftState,
      preparedWorkflow.state,
      params
    )
    if ('error' in prepared) {
      return { success: false, error: prepared.error }
    }
    const result = await executeCopilotWorkflowTarget({
      workflow: {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      input: prepared.input,
      context,
      options: {
        enabled: true,
        useDraftState,
        workflowTriggerType: 'copilot',
        triggerBlockId: prepared.triggerBlockId,
      },
    })

    return buildExecutionOutput(result)
  } catch (error) {
    return buildExecutionError(error)
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
    const { workflow: workflowRecord } = await executeCopilotWorkflowUseCase(
      context,
      readWorkflowDefinition,
      { workflowId, assertedWorkspaceId: context.workspaceId, state: 'draft' }
    )

    interface WorkflowVariable {
      id: string
      workflowId?: string
      name: string
      type: string
      value?: unknown
    }
    const currentVarsRecord = (workflowRecord.variables as Record<string, unknown>) || {}
    const byName: Record<string, WorkflowVariable> = {}
    Object.values(currentVarsRecord).forEach((v) => {
      if (v && typeof v === 'object' && 'id' in v && 'name' in v) {
        const variable = v as WorkflowVariable
        byName[String(variable.name)] = variable
      }
    })

    for (const op of operations) {
      const key = String(op?.name || '')
      if (!key) continue
      const nextType = op?.type || byName[key]?.type || 'plain'
      const coerceValue = (value: unknown, type: string): unknown => {
        if (value === undefined) return value
        if (type === 'number') {
          const n = Number(value)
          return Number.isNaN(n) ? value : n
        }
        if (type === 'boolean') {
          const v = String(value).trim().toLowerCase()
          if (v === 'true') return true
          if (v === 'false') return false
          return value
        }
        if (type === 'array' || type === 'object') {
          try {
            const parsed = JSON.parse(String(value))
            if (type === 'array' && Array.isArray(parsed)) return parsed
            if (type === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              return parsed
          } catch (error) {
            logger.warn('Failed to parse JSON value for variable coercion', {
              error: toError(error).message,
            })
          }
          return value
        }
        return value
      }

      if (op.operation === 'delete') {
        delete byName[key]
        continue
      }
      const typedValue = coerceValue(op.value, nextType)
      if (op.operation === 'add') {
        byName[key] = {
          id: generateId(),
          workflowId,
          name: key,
          type: nextType,
          value: typedValue,
        }
        continue
      }
      if (op.operation === 'edit') {
        if (!byName[key]) {
          byName[key] = {
            id: generateId(),
            workflowId,
            name: key,
            type: nextType,
            value: typedValue,
          }
        } else {
          byName[key] = {
            ...byName[key],
            type: nextType,
            value: typedValue,
          }
        }
      }
    }

    const nextVarsRecord = Object.fromEntries(Object.values(byName).map((v) => [String(v.id), v]))

    assertWorkflowMutationNotAborted(context)
    const result = await executeCopilotWorkflowUseCase(context, updateWorkflowVariables, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      variables: nextVarsRecord,
      operationCount: operations.length,
      source: 'copilot',
    })

    return { success: true, output: result }
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

    const folderId = params.folderId || null
    const moved: string[] = []
    const failed: string[] = []

    for (const workflowId of workflowIds) {
      try {
        assertWorkflowMutationNotAborted(context)
        await executeCopilotWorkflowUseCase(context, updateWorkflow, {
          workflowId,
          assertedWorkspaceId: context.workspaceId,
          folderId,
        })
        moved.push(workflowId)
      } catch {
        failed.push(workflowId)
      }
    }

    return { success: moved.length > 0, output: { moved, failed, folderId } }
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
      return { success: false, error: 'workflowId is required' }
    }
    if (!params.stopAfterBlockId) {
      return { success: false, error: 'stopAfterBlockId is required' }
    }

    const useDraftState = !params.useDeployedState
    const preparedWorkflow = await prepareWorkflowRunForCopilot(context, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      state: useDraftState ? 'draft' : 'deployed',
    })
    const workflowRecord = preparedWorkflow.workflow
    const prepared = await resolveValidatedTriggerRun(
      workflowId,
      useDraftState,
      preparedWorkflow.state,
      params
    )
    if ('error' in prepared) {
      return { success: false, error: prepared.error }
    }
    const result = await executeCopilotWorkflowTarget({
      workflow: {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      input: prepared.input,
      context,
      options: {
        enabled: true,
        useDraftState,
        stopAfterBlockId: params.stopAfterBlockId,
        workflowTriggerType: 'copilot',
        triggerBlockId: prepared.triggerBlockId,
      },
    })

    return buildExecutionOutput(result, { stoppedAfterBlockId: params.stopAfterBlockId })
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

    const workspaceId =
      params.workspaceId || context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'admin')
    assertWorkflowMutationNotAborted(context)

    const result = await performCreateWorkspaceApiKey({
      workspaceId,
      userId: context.userId,
      name,
      source: 'copilot',
    })
    if (!result.success || !result.key) {
      return { success: false, error: result.error || 'Failed to generate API key' }
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
    return { success: false, error: toError(error).message }
  }
}

export async function executeRunFromBlock(
  params: RunFromBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!params.startBlockId) {
      return { success: false, error: 'startBlockId is required' }
    }

    const useDraftState = !params.useDeployedState
    const preparedWorkflow = await prepareWorkflowRunForCopilot(context, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      state: useDraftState ? 'draft' : 'deployed',
      sourceExecutionId: params.executionId,
      useLatestExecution: !params.executionId,
    })
    const sourceSnapshot = preparedWorkflow.sourceSnapshot

    if (!sourceSnapshot) {
      return {
        success: false,
        error: params.executionId
          ? `No execution state found for execution ${params.executionId}. Run the full workflow first.`
          : `No execution state found for workflow ${workflowId}. Run the full workflow first to create a snapshot.`,
      }
    }

    const workflowRecord = preparedWorkflow.workflow

    const result = await executeCopilotWorkflowTarget({
      workflow: {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      input: resolveRunWorkflowInput(params),
      context,
      options: {
        enabled: true,
        useDraftState,
        workflowTriggerType: 'copilot',
        runFromBlock: {
          startBlockId: params.startBlockId,
          sourceSnapshot: sourceSnapshot.snapshot,
          sourceExecutionId: sourceSnapshot.executionId,
        },
      },
    })

    return buildExecutionOutput(result, { startBlockId: params.startBlockId })
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
    const { workflow: workflowRecord, state: normalized } = await executeCopilotWorkflowUseCase(
      context,
      readWorkflowDefinition,
      { workflowId, assertedWorkspaceId: context.workspaceId, state: 'draft' }
    )
    if (!normalized) {
      return { success: false, error: `Workflow ${workflowId} has no normalized state` }
    }

    const currentState: WorkflowState = {
      blocks: normalized.blocks as Record<string, BlockState>,
      edges: normalized.edges || [],
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
      lastSaved: Date.now(),
    }

    const currentBlocks = currentState.blocks
    const targetBlock = currentBlocks[params.blockId]
    if (!targetBlock) {
      return {
        success: false,
        error: `Block ${params.blockId} not found in workflow ${workflowId}`,
      }
    }
    if (isBlockProtected(params.blockId, currentBlocks)) {
      return {
        success: false,
        error: `Block ${params.blockId} is locked or inside a locked container and cannot be updated`,
      }
    }
    if (targetBlock.enabled === params.enabled) {
      return {
        success: true,
        output: {
          workflowId,
          workflowName: workflowRecord.name,
          blockId: params.blockId,
          enabled: params.enabled,
          affectedBlockIds: [params.blockId],
          workflowState: currentState,
          copilotSanitizedWorkflowState: sanitizeForCopilot(currentState),
          message: `Block ${params.blockId} is already ${params.enabled ? 'enabled' : 'disabled'}`,
        },
      }
    }
    if (params.enabled && hasDisabledAncestor(params.blockId, currentBlocks)) {
      return {
        success: false,
        error: `Cannot enable block ${params.blockId} while one of its parent containers is disabled. Enable the parent first.`,
      }
    }

    const affectedBlockIds = new Set<string>([params.blockId])
    if (targetBlock.type === 'loop' || targetBlock.type === 'parallel') {
      for (const descendantId of findDescendants(params.blockId, currentBlocks)) {
        if (!isBlockProtected(descendantId, currentBlocks)) {
          affectedBlockIds.add(descendantId)
        }
      }
    }

    const nextBlocks: Record<string, BlockState> = { ...currentBlocks }
    for (const blockId of affectedBlockIds) {
      nextBlocks[blockId] = {
        ...nextBlocks[blockId],
        enabled: params.enabled,
      }
    }

    const nextState: WorkflowState = {
      ...currentState,
      blocks: nextBlocks,
      lastSaved: Date.now(),
    }

    assertWorkflowMutationNotAborted(context)
    await executeCopilotWorkflowUseCase(context, updateWorkflowState, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      state: nextState,
    })

    return {
      success: true,
      output: {
        workflowId,
        workflowName: workflowRecord.name,
        blockId: params.blockId,
        enabled: params.enabled,
        affectedBlockIds: Array.from(affectedBlockIds),
        workflowState: nextState,
        copilotSanitizedWorkflowState: sanitizeForCopilot(nextState),
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

type FolderPathIndex = Map<string, string | null>

/**
 * Load an index from each canonical encoded VFS path to its folder id. A null
 * value records that multiple folder ids collapse to the same canonical path,
 * so callers can reject the ambiguous path instead of silently choosing one.
 */
async function loadFolderPathIndex(
  workspaceId: string,
  context: ExecutionContext
): Promise<FolderPathIndex> {
  const { folders } = await executeCopilotWorkflowUseCase(context, listWorkflowFolders, {
    workspaceId,
    sortBy: 'name',
    sortOrder: 'asc',
  })
  const byPath: FolderPathIndex = new Map()
  for (const [folderId, encodedPath] of buildVfsFolderPathMap(
    folders.map((folder) => ({
      folderId: folder.id,
      folderName: folder.name,
      parentId: folder.parentId,
    }))
  ).entries()) {
    if (!byPath.has(encodedPath)) {
      byPath.set(encodedPath, folderId)
    } else if (byPath.get(encodedPath) !== folderId) {
      byPath.set(encodedPath, null)
    }
  }
  return byPath
}

function resolveFolderIdByPath(
  rawPath: string,
  byPath: FolderPathIndex,
  label = 'Folder'
): { folderId: string } | { error: string } {
  const relative = workflowFolderRelativePath(rawPath)
  if (!relative) return { error: `${label} not found at ${rawPath}` }

  const canonicalPath = encodeVfsPathSegments(decodeVfsPathSegments(relative))
  if (!byPath.has(canonicalPath)) return { error: `${label} not found at ${rawPath}` }

  const folderId = byPath.get(canonicalPath)
  if (!folderId) {
    return {
      error: `${label} path is ambiguous after canonicalization: ${rawPath}. Rename one of the conflicting folders and retry.`,
    }
  }
  return { folderId }
}

export async function executeRunBlock(
  params: RunBlockParams,
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

    const useDraftState = !params.useDeployedState
    const preparedWorkflow = await prepareWorkflowRunForCopilot(context, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      state: useDraftState ? 'draft' : 'deployed',
      sourceExecutionId: params.executionId,
      useLatestExecution: !params.executionId,
    })
    const sourceSnapshot = preparedWorkflow.sourceSnapshot

    if (!sourceSnapshot) {
      return {
        success: false,
        error: params.executionId
          ? `No execution state found for execution ${params.executionId}. Run the full workflow first.`
          : `No execution state found for workflow ${workflowId}. Run the full workflow first to create a snapshot.`,
      }
    }

    const workflowRecord = preparedWorkflow.workflow

    const result = await executeCopilotWorkflowTarget({
      workflow: {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      input: resolveRunWorkflowInput(params),
      context,
      options: {
        enabled: true,
        useDraftState,
        workflowTriggerType: 'copilot',
        runFromBlock: {
          startBlockId: params.blockId,
          sourceSnapshot: sourceSnapshot.snapshot,
          sourceExecutionId: sourceSnapshot.executionId,
        },
        stopAfterBlockId: params.blockId,
      },
    })

    return buildExecutionOutput(result, { blockId: params.blockId })
  } catch (error) {
    return buildExecutionError(error)
  }
}
