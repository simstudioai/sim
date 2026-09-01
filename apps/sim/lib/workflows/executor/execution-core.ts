/**
 * Core workflow execution logic - shared by all execution paths
 * This is the SINGLE source of truth for workflow execution
 */

import { resolvePrincipalSubject } from '@sim/auth/principal'
import { db } from '@sim/db'
import { organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { filterUndefined, isPlainRecord, isRecordLike } from '@sim/utils/object'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import type { Edge } from '@xyflow/react'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type EffectivePiiRedaction, resolveEffectivePiiRedaction } from '@/lib/billing/retention'
import {
  getExecutionDeadlineAt,
  getTimeoutErrorMessage,
  isTimeoutAbortReason,
} from '@/lib/core/execution-limits'
import { getExecutionEnvironment } from '@/lib/environment/utils'
import { clearExecutionCancellation } from '@/lib/execution/cancellation'
import { warmLargeValueRefs } from '@/lib/execution/payloads/hydration'
import { parseLargeExecutionValue } from '@/lib/execution/payloads/large-execution-value'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { redactLargeValueRefsInValue } from '@/lib/logs/execution/pii-large-values'
import { redactObjectStrings } from '@/lib/logs/execution/pii-redaction'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getUserEmailById } from '@/lib/users/queries'
import { waitForChildRuns } from '@/lib/workflows/custom-blocks/child-execution'
import { getCustomBlockRowsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import {
  loadDeployedWorkflowState,
  loadWorkflowDeploymentVersionState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import { Executor } from '@/executor'
import type { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type {
  BlockCompletionCallbackData,
  ChildWorkflowContext,
  ContextExtensions,
  ExecutionCallbacks,
  IterationContext,
  SerializableExecutionState,
} from '@/executor/execution/types'
import type { ExecutionResult, StartBlockRunMetadata } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import {
  createResolvedSecretTraceRegistry,
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import { isRunMetadataEnabled } from '@/executor/utils/start-block'
import { buildParallelSentinelEndId, buildSentinelEndId } from '@/executor/utils/subflow-utils'
import { Serializer } from '@/serializer'

const logger = createLogger('ExecutionCore')

const EnvVarsSchema = z.record(z.string(), z.string())

/**
 * Surfaces the underlying driver error from a wrapped error chain.
 *
 * Drizzle wraps the original `postgres`/Node driver error as `error.cause`,
 * which the logger's Error serializer drops (it only emits own-enumerable
 * keys). Walking the chain from `error` itself and preferring the first error
 * carrying a `code` exposes the diagnostic fields — notably the Postgres
 * `code` — that distinguish a connection drop (`08006`), a rejected connection
 * (`53300`), and a statement timeout (`57014`) behind an opaque "Failed query"
 * message. Starting at `error` also captures a bare driver error that reaches
 * this path unwrapped; when no error in the chain carries a `code`, it falls
 * back to the first wrapped cause (the top-level error is already logged on its
 * own, so it is not echoed here).
 */
function describeErrorCause(error: unknown): Record<string, unknown> | undefined {
  try {
    let driver: (Error & Record<string, unknown>) | undefined
    let current: unknown = error
    for (let depth = 0; depth < 10 && current instanceof Error; depth++) {
      const candidate = current as Error & Record<string, unknown>
      if (candidate.code !== undefined) {
        driver = candidate
        break
      }
      if (depth === 1) driver = candidate
      current = candidate.cause
    }
    if (!driver) return undefined
    return filterUndefined({
      name: driver.name,
      message: driver.message,
      code: driver.code,
      severity: driver.severity,
      detail: driver.detail,
      routine: driver.routine,
      errno: driver.errno,
      syscall: driver.syscall,
    })
  } catch {
    return undefined
  }
}

export interface ExecuteWorkflowCoreOptions {
  snapshot: ExecutionSnapshot
  callbacks: ExecutionCallbacks
  loggingSession: LoggingSession
  skipLogCreation?: boolean
  abortSignal?: AbortSignal
  includeFileBase64?: boolean
  base64MaxBytes?: number
  stopAfterBlockId?: string
  /** Trusted encrypted provenance captured by a server-only pre-execution boundary. */
  trustedInitialResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Immutable deployment admitted by the durable parent log for a resumed execution. */
  resumeDeploymentVersionId?: string
  /** Run-from-block mode: execute starting from a specific block using cached upstream outputs */
  runFromBlock?: {
    startBlockId: string
    sourceSnapshot: SerializableExecutionState
    sourceExecutionId?: string
    /** Mocked upstream outputs (block name/id → output object) overlaid on the snapshot. */
    variableInputs?: Record<string, unknown>
  }
}

function parseVariableValueByType(value: unknown, type: string): unknown {
  const refValue = parseLargeExecutionValue(value)
  if (refValue !== undefined) {
    return refValue
  }

  if (value === null || value === undefined) {
    switch (type) {
      case 'number':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'object':
        return {}
      default:
        return ''
    }
  }

  if (type === 'number') {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const num = Number(value)
      return Number.isNaN(num) ? 0 : num
    }
    return 0
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true'
    }
    return Boolean(value)
  }

  if (type === 'array') {
    if (Array.isArray(value)) return value
    if (typeof value === 'string' && value.trim()) {
      try {
        return JSON.parse(value)
      } catch {
        return []
      }
    }
    return []
  }

  if (type === 'object') {
    if (isRecordLike(value)) return value
    if (typeof value === 'string' && value.trim()) {
      try {
        return JSON.parse(value)
      } catch {
        return {}
      }
    }
    return {}
  }

  // string or plain
  return typeof value === 'string' ? value : String(value)
}

function restoreBlockStateSecretProvenance(
  redacted: SerializableExecutionState['blockStates'],
  original: SerializableExecutionState['blockStates']
): SerializableExecutionState['blockStates'] {
  for (const [blockId, originalState] of Object.entries(original)) {
    const redactedState = redacted[blockId]
    if (redactedState && originalState.resolvedSecretTraceProvenance) {
      redacted[blockId] = {
        ...redactedState,
        resolvedSecretTraceProvenance: originalState.resolvedSecretTraceProvenance,
      }
    }
  }
  return redacted
}

type ExecutionErrorWithFinalizationFlag = Error & {
  executionFinalizedByCore?: boolean
}

export const FINALIZED_EXECUTION_ID_TTL_MS = 5 * 60 * 1000

const finalizedExecutionIds = new Map<string, number>()

function cleanupExpiredFinalizedExecutionIds(now = Date.now()): void {
  for (const [executionId, expiresAt] of finalizedExecutionIds.entries()) {
    if (expiresAt <= now) {
      finalizedExecutionIds.delete(executionId)
    }
  }
}

function rememberFinalizedExecutionId(executionId: string): void {
  const now = Date.now()

  cleanupExpiredFinalizedExecutionIds(now)
  finalizedExecutionIds.set(executionId, now + FINALIZED_EXECUTION_ID_TTL_MS)
}

async function clearExecutionCancellationSafely(
  executionId: string,
  requestId: string
): Promise<void> {
  try {
    await clearExecutionCancellation(executionId)
  } catch (error) {
    logger.error(`[${requestId}] Failed to clear execution cancellation`, { error, executionId })
  }
}

function markExecutionFinalizedByCore(error: unknown, executionId: string): void {
  rememberFinalizedExecutionId(executionId)

  if (error instanceof Error) {
    ;(error as ExecutionErrorWithFinalizationFlag).executionFinalizedByCore = true
  }
}

export function wasExecutionFinalizedByCore(error: unknown, executionId?: string): boolean {
  cleanupExpiredFinalizedExecutionIds()

  if (executionId && finalizedExecutionIds.has(executionId)) {
    return true
  }

  return (
    error instanceof Error &&
    (error as ExecutionErrorWithFinalizationFlag).executionFinalizedByCore === true
  )
}

async function finalizeExecutionOutcome(params: {
  result: ExecutionResult
  loggingSession: LoggingSession
  executionId: string
  requestId: string
  workflowInput: unknown
  abortSignal?: AbortSignal
}): Promise<void> {
  const { result, loggingSession, executionId, requestId, workflowInput, abortSignal } = params
  const { traceSpans, totalDuration } = buildTraceSpans(result)
  const endedAt = new Date().toISOString()

  try {
    if (result.status === 'cancelled' && isTimeoutAbortReason(abortSignal?.reason)) {
      await loggingSession.safeCompleteWithError({
        endedAt,
        totalDurationMs: totalDuration || 0,
        error: { message: getTimeoutErrorMessage(null) },
        traceSpans: traceSpans || [],
        executionState: result.executionState,
      })
    } else if (result.status === 'cancelled') {
      await loggingSession.safeCompleteWithCancellation({
        endedAt,
        totalDurationMs: totalDuration || 0,
        traceSpans: traceSpans || [],
        executionState: result.executionState,
      })
    } else if (result.status === 'paused') {
      await loggingSession.safeCompleteWithPause({
        endedAt,
        totalDurationMs: totalDuration || 0,
        traceSpans: traceSpans || [],
        workflowInput,
        executionState: result.executionState,
      })
      if (
        loggingSession.hasCompleted() &&
        loggingSession.getPersistedCompletionStatus() === 'cancelled'
      ) {
        await clearExecutionCancellationSafely(executionId, requestId)
      }
      return
    } else {
      await loggingSession.safeComplete({
        endedAt,
        totalDurationMs: totalDuration || 0,
        finalOutput: result.output || {},
        traceSpans: traceSpans || [],
        workflowInput,
        executionState: result.executionState,
      })
    }

    if (loggingSession.hasCompleted()) {
      await clearExecutionCancellationSafely(executionId, requestId)
    }
  } catch (error) {
    logger.warn(
      `[${requestId}] Post-execution finalization failed`,
      loggingSession.projectDiagnosticError(error, {
        executionId,
        status: result.status,
      })
    )
  }
}

async function finalizeExecutionError(params: {
  error: unknown
  loggingSession: LoggingSession
  executionId: string
  requestId: string
}): Promise<boolean> {
  const { error, loggingSession, executionId, requestId } = params
  const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
  const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

  try {
    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: executionResult?.metadata?.duration || 0,
      error: {
        message: getErrorMessage(error, 'Execution failed'),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      traceSpans,
      executionState: executionResult?.executionState,
    })

    const finalized = loggingSession.hasCompleted()
    if (finalized) {
      await clearExecutionCancellationSafely(executionId, requestId)
    }
    return finalized
  } catch (postExecError) {
    logger.error(
      `[${requestId}] Post-execution error logging failed`,
      loggingSession.projectDiagnosticError(postExecError, { executionId })
    )
    return false
  }
}

/**
 * Establish the custom-block registry overlay for the execution's organization,
 * then run the core. Wrapping here — the shared choke point for the sync route and
 * the background job — puts `custom_block_*` types in scope for serialization,
 * execution, and any nested child-workflow serialization (ALS propagates to the
 * whole async subtree).
 */
export async function executeWorkflowCore(
  options: ExecuteWorkflowCoreOptions
): Promise<ExecutionResult> {
  const workspaceId = options.snapshot.metadata.workspaceId
  const rows = workspaceId ? await getCustomBlockRowsForWorkspace(workspaceId) : []
  return withCustomBlockOverlay(rows, () => executeWorkflowCoreImpl(options))
}

async function executeWorkflowCoreImpl(
  options: ExecuteWorkflowCoreOptions
): Promise<ExecutionResult> {
  const {
    snapshot,
    callbacks,
    loggingSession,
    skipLogCreation,
    abortSignal,
    includeFileBase64,
    base64MaxBytes,
    stopAfterBlockId,
    runFromBlock,
    resumeDeploymentVersionId,
  } = options
  loggingSession.setExecutionDeadlineAt(getExecutionDeadlineAt(abortSignal))
  const { metadata, input, workflowVariables, selectedOutputs } = snapshot
  const { requestId, workflowId, userId, triggerType, executionId, triggerBlockId, useDraftState } =
    metadata
  const { onBlockStart, onBlockComplete, onStream, onChildWorkflowInstanceReady } = callbacks

  const providedWorkspaceId = metadata.workspaceId
  if (!providedWorkspaceId) {
    throw new Error(`Execution metadata missing workspaceId for workflow ${workflowId}`)
  }
  const resumeFromSnapshot = metadata.resumeFromSnapshot === true
  if (!resumeFromSnapshot && resumeDeploymentVersionId !== undefined) {
    throw new Error('Deployment version authority can only be supplied for a resumed execution')
  }
  if (resumeFromSnapshot && useDraftState && resumeDeploymentVersionId !== undefined) {
    throw new Error('Draft resume cannot carry deployment version authority')
  }
  if (resumeFromSnapshot && !useDraftState && !resumeDeploymentVersionId) {
    throw new Error('Deployed resume requires its admitted deployment version')
  }

  let processedInput = input || {}
  let deploymentVersionId: string | undefined
  let loggingStarted = false
  let resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry | undefined
  const pendingLifecycleCallbacks = new Set<Promise<void>>()

  const trackLifecycleCallback = (promise: Promise<void>) => {
    pendingLifecycleCallbacks.add(promise)
    void promise
      .finally(() => {
        pendingLifecycleCallbacks.delete(promise)
      })
      .catch(() => {})
  }

  const waitForLifecycleCallbacks = async () => {
    while (pendingLifecycleCallbacks.size > 0) {
      await Promise.allSettled([...pendingLifecycleCallbacks])
    }
    // A custom block's child is a separate execution with its own log row, and
    // the engine does not drain in-flight nodes on cancel/timeout — await it here
    // (bounded) so the row is not left `running` when this run finishes or the
    // worker exits.
    await waitForChildRuns(executionId)
  }

  try {
    /**
     * Personal variables belong to whoever is running, whenever that is knowable.
     * `enforceCredentialAccess` is the principal layer's own answer to "is there
     * an identifiable caller": it is set from `principal.kind !== 'workspace_api_key'`,
     * so a session, personal API key, or delegated run reads its own personal
     * variables rather than borrowing the workflow owner's.
     *
     * The workflow owner remains the fallback for a workspace API key, schedule,
     * or webhook. Someone in the workspace configured each of those, and a
     * deployed workflow is routinely authored against its owner's personal keys.
     *
     * An anonymous public-API run resolves no personal variables at all. Anyone
     * can call that endpoint, so there is no caller to read as and no person whose
     * private namespace it would be reasonable to lend — such a workflow runs on
     * workspace secrets alone.
     */
    const identifiedCallerUserId =
      (metadata.isClientSession && metadata.sessionUserId) ||
      (metadata.enforceCredentialAccess ? metadata.userId : undefined)

    const personalEnvUserId = metadata.isPublicApiAccess
      ? undefined
      : identifiedCallerUserId || metadata.workflowUserId

    if (!metadata.isPublicApiAccess && !personalEnvUserId) {
      throw new Error('Missing workflowUserId in execution metadata')
    }

    /**
     * The actor already carries the identity each trigger kind should authorize
     * workspace secrets against: the caller for a session, personal API key, or
     * delegated principal, and the workspace billing account for a workspace API
     * key, schedule, webhook, or anonymous public-API call, where no caller is
     * identifiable. Deriving it again here would only risk disagreeing with the
     * principal layer.
     */
    const workspaceEnvUserId = metadata.userId || personalEnvUserId
    if (!workspaceEnvUserId) {
      throw new Error('Missing execution actor in execution metadata')
    }

    /**
     * Resolves the workflow state from the override, the draft tables, or the
     * deployed snapshot. The async load (draft/deployed) has no data dependency
     * on the environment load, so the two are awaited concurrently below.
     */
    const loadWorkflowState = async () => {
      if (resumeFromSnapshot && !useDraftState) {
        if (!resumeDeploymentVersionId) {
          throw new Error('Deployed resume requires its admitted deployment version')
        }
        const deployedData = await loadWorkflowDeploymentVersionState(
          workflowId,
          resumeDeploymentVersionId,
          providedWorkspaceId
        )
        logger.info(`[${requestId}] Using admitted historical deployment state (resumed execution)`)
        return {
          blocks: deployedData.blocks,
          edges: deployedData.edges,
          loops: deployedData.loops,
          parallels: deployedData.parallels,
          deploymentVersionId: deployedData.deploymentVersionId,
        }
      }

      if (metadata.workflowStateOverride) {
        const override = metadata.workflowStateOverride
        logger.info(`[${requestId}] Using workflow state override (diff workflow execution)`, {
          blocksCount: Object.keys(override.blocks).length,
          edgesCount: override.edges.length,
        })
        return {
          blocks: override.blocks,
          edges: override.edges,
          loops: override.loops || {},
          parallels: override.parallels || {},
          deploymentVersionId: override.deploymentVersionId,
        }
      }

      if (useDraftState) {
        const draftData = await loadWorkflowFromNormalizedTables(workflowId)

        if (!draftData) {
          throw new Error('Workflow not found or not yet saved')
        }

        logger.info(
          `[${requestId}] Using draft workflow state from normalized tables (client execution)`
        )
        return {
          blocks: draftData.blocks,
          edges: draftData.edges,
          loops: draftData.loops,
          parallels: draftData.parallels,
          deploymentVersionId: undefined,
        }
      }

      const deployedData = await loadDeployedWorkflowState(workflowId, providedWorkspaceId)
      logger.info(`[${requestId}] Using deployed workflow state (deployed execution)`)
      return {
        blocks: deployedData.blocks,
        edges: deployedData.edges,
        loops: deployedData.loops,
        parallels: deployedData.parallels,
        deploymentVersionId: deployedData.deploymentVersionId,
      }
    }

    const [workflowState, env] = await Promise.all([
      loadWorkflowState(),
      getExecutionEnvironment(personalEnvUserId, workspaceEnvUserId, providedWorkspaceId),
    ])

    const { blocks, loops, parallels } = workflowState
    const edges: Edge[] = workflowState.edges
    deploymentVersionId = workflowState.deploymentVersionId

    const mergedStates = mergeSubblockStateWithValues(blocks)

    const {
      personalEncrypted,
      workspaceEncrypted,
      personalDecrypted,
      workspaceDecrypted,
      decryptionFailures,
      personalOwners,
      workspaceUnredactedKeys,
    } = env

    // Use encrypted values for logging (don't log decrypted secrets)
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    // Use already-decrypted values for execution (no redundant decryption)
    const decryptedEnvVars: Record<string, string> = { ...personalDecrypted, ...workspaceDecrypted }

    const restoredState =
      runFromBlock?.sourceSnapshot ?? (resumeFromSnapshot ? snapshot.state : undefined)
    const restoreTrusted = resumeFromSnapshot || Boolean(runFromBlock?.sourceExecutionId)
    const trustedLargeValueAccess = restoreTrusted
      ? restoredState?.trustedLargeValueAccess
      : undefined
    const requireRestoredProvenance = restoredState !== undefined
    resolvedSecretTraceRegistry = await createResolvedSecretTraceRegistry({
      personalEncrypted,
      workspaceEncrypted,
      personalDecrypted,
      workspaceDecrypted,
      decryptionFailures,
      personalOwners,
      workspaceUnredactedKeys,
      restoredProvenance: restoreTrusted ? restoredState?.resolvedSecretTraceProvenance : undefined,
      restoredCheckpointVersion: restoredState?.resolvedSecretTraceCheckpointVersion,
      restoreTrusted,
      requireRestoredProvenance,
      scope: { userId: personalEnvUserId ?? workspaceEnvUserId, workspaceId: providedWorkspaceId },
    })
    if (restoredState && !restoreTrusted) {
      resolvedSecretTraceRegistry.markIncomplete('restored-provenance-untrusted')
    }
    if (options.trustedInitialResolvedSecretTraceProvenance !== undefined) {
      await resolvedSecretTraceRegistry.importProvenance(
        options.trustedInitialResolvedSecretTraceProvenance,
        { trusted: true, origin: 'executionCore.initialProvenance' }
      )
    }
    loggingSession.setResolvedSecretTraceRegistry(resolvedSecretTraceRegistry)

    loggingStarted = await loggingSession.safeStart({
      userId,
      billingAttribution: metadata.billingAttribution,
      workspaceId: providedWorkspaceId,
      variables,
      triggerData: metadata.correlation ? { correlation: metadata.correlation } : undefined,
      skipLogCreation,
      deploymentVersionId,
      workflowState: { blocks, edges, loops, parallels },
    })

    // Use edges directly - trigger-to-trigger edges are prevented at creation time
    const filteredEdges = edges

    // Check if this is a resume execution before trigger resolution
    const resumePendingQueue = snapshot.state?.pendingQueue
    const resumeRemainingEdges = snapshot.state?.remainingEdges
    const resumeTerminalNoop = metadata.resumeTerminalNoop === true

    let resolvedTriggerBlockId = triggerBlockId

    // Resume executions derive their queue from the snapshot. Even an empty
    // queue is meaningful: a terminal pause block has no downstream work.
    if (
      resumeFromSnapshot &&
      (resumePendingQueue !== undefined || resumeRemainingEdges !== undefined || resumeTerminalNoop)
    ) {
      resolvedTriggerBlockId = undefined
      logger.info(`[${requestId}] Skipping trigger resolution for resume execution`, {
        pendingQueueLength: resumePendingQueue?.length ?? 0,
        remainingEdgeCount: resumeRemainingEdges?.length ?? 0,
        resumeTerminalNoop,
      })
    } else if (!triggerBlockId) {
      const executionKind =
        triggerType === 'api' || triggerType === 'chat'
          ? (triggerType as 'api' | 'chat')
          : triggerType === 'webhook' || triggerType === 'schedule'
            ? 'external'
            : 'manual'

      const startBlock = TriggerUtils.findStartBlock(mergedStates, executionKind, false)

      if (!startBlock) {
        const errorMsg = 'No start block found. Add a start block to this workflow.'
        logger.error(`[${requestId}] ${errorMsg}`)
        throw new Error(errorMsg)
      }

      resolvedTriggerBlockId = startBlock.blockId
      logger.info(`[${requestId}] Identified trigger block for ${executionKind} execution:`, {
        blockId: resolvedTriggerBlockId,
        blockType: startBlock.block.type,
        path: startBlock.path,
      })
    }

    // Serialize workflow
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      filteredEdges,
      loops,
      parallels,
      true
    )
    processedInput = input || {}

    // Resolve stopAfterBlockId for loop/parallel containers to their sentinel-end IDs
    let resolvedStopAfterBlockId = stopAfterBlockId
    if (stopAfterBlockId) {
      if (serializedWorkflow.loops?.[stopAfterBlockId]) {
        resolvedStopAfterBlockId = buildSentinelEndId(stopAfterBlockId)
      } else if (serializedWorkflow.parallels?.[stopAfterBlockId]) {
        resolvedStopAfterBlockId = buildParallelSentinelEndId(stopAfterBlockId)
      }
    }

    // Create and execute workflow with callbacks
    if (resumeFromSnapshot) {
      logger.info(`[${requestId}] Resume execution detected`, {
        resumePendingQueue,
        hasState: !!snapshot.state,
        stateBlockStatesCount: snapshot.state
          ? Object.keys(snapshot.state.blockStates || {}).length
          : 0,
        executedBlocksCount: snapshot.state?.executedBlocks?.length ?? 0,
        useDraftState,
      })
    }

    const wrappedOnBlockComplete = (
      blockId: string,
      blockName: string,
      blockType: string,
      output: BlockCompletionCallbackData,
      iterationContext?: IterationContext,
      childWorkflowContext?: ChildWorkflowContext
    ) => {
      let persistenceSucceeded = false
      const persistencePromise = (async () => {
        await loggingSession.onBlockComplete(blockId, blockName, blockType, output)
        persistenceSucceeded = true
      })().catch((error) => {
        logger.warn(
          `[${requestId}] Block completion persistence failed`,
          loggingSession.projectDiagnosticError(error, {
            executionId,
            blockId,
            blockType,
          })
        )
      })

      const lifecyclePromise = (async () => {
        await persistencePromise
        if (!persistenceSucceeded || !onBlockComplete) return

        try {
          await onBlockComplete(
            blockId,
            blockName,
            blockType,
            output,
            iterationContext,
            childWorkflowContext
          )
        } catch (error) {
          logger.warn(
            `[${requestId}] Block completion callback failed`,
            loggingSession.projectDiagnosticError(error, {
              executionId,
              blockId,
              blockType,
            })
          )
        }
      })()

      trackLifecycleCallback(lifecyclePromise)
      return persistencePromise
    }

    const wrappedOnBlockStart = (
      blockId: string,
      blockName: string,
      blockType: string,
      executionOrder: number,
      iterationContext?: IterationContext,
      childWorkflowContext?: ChildWorkflowContext
    ) => {
      let persistenceSucceeded = false
      const persistencePromise = (async () => {
        await loggingSession.onBlockStart(blockId, blockName, blockType, new Date().toISOString())
        persistenceSucceeded = true
      })().catch((error) => {
        logger.warn(
          `[${requestId}] Block start persistence failed`,
          loggingSession.projectDiagnosticError(error, {
            executionId,
            blockId,
            blockType,
          })
        )
      })

      const lifecyclePromise = (async () => {
        await persistencePromise
        if (!persistenceSucceeded || !onBlockStart) return

        try {
          await onBlockStart(
            blockId,
            blockName,
            blockType,
            executionOrder,
            iterationContext,
            childWorkflowContext
          )
        } catch (error) {
          logger.warn(
            `[${requestId}] Block start callback failed`,
            loggingSession.projectDiagnosticError(error, {
              executionId,
              blockId,
              blockType,
            })
          )
        }
      })()

      trackLifecycleCallback(lifecyclePromise)
      return persistencePromise
    }

    const largeValueExecutionIds = Array.from(
      new Set(
        [
          executionId,
          runFromBlock?.sourceExecutionId,
          ...(metadata.largeValueExecutionIds ?? []),
          ...(trustedLargeValueAccess?.executionIds ?? []),
        ].filter((id): id is string => Boolean(id))
      )
    )
    const largeValueKeys = Array.from(
      new Set([
        ...(metadata.largeValueKeys ?? []),
        ...(trustedLargeValueAccess?.largeValueKeys ?? []),
      ])
    )
    const fileKeys = Array.from(
      new Set([...(metadata.fileKeys ?? []), ...(trustedLargeValueAccess?.fileKeys ?? [])])
    )
    const allowLargeValueWorkflowScope =
      metadata.allowLargeValueWorkflowScope === true ||
      metadata.resumeFromSnapshot === true ||
      Boolean(runFromBlock?.sourceSnapshot && !runFromBlock.sourceExecutionId) ||
      Boolean(runFromBlock?.sourceExecutionId && !trustedLargeValueAccess)
    loggingSession.setTraceLargeValueAccess({
      largeValueExecutionIds,
      largeValueKeys,
      fileKeys,
      allowLargeValueWorkflowScope,
    })

    // Resolve the org/workspace PII redaction policy once; serves both the input
    // stage (below) and the block-outputs stage (threaded into the executor).
    // Stored rules are the source of truth; absence yields the disabled default
    // with one indexed lookup and no masking cost for non-PII organizations.
    const [row] = await db
      .select({ orgSettings: organization.dataRetentionSettings })
      .from(workspace)
      .leftJoin(organization, eq(organization.id, workspace.organizationId))
      .where(eq(workspace.id, providedWorkspaceId))
      .limit(1)
    const piiRedaction: EffectivePiiRedaction = resolveEffectivePiiRedaction({
      orgSettings: row?.orgSettings,
      workspaceId: providedWorkspaceId,
    })

    if (piiRedaction.input.enabled) {
      // Redact the input before the workflow sees it. `onFailure: 'throw'` aborts
      // the run (handled by the surrounding catch) rather than feeding a scrub
      // marker into execution or leaking unredacted input. A large input may
      // already be offloaded to a large-value ref (opaque to the string walk), so
      // hydrate → mask → re-store refs first, then mask inline strings.
      const inputOpts = {
        entityTypes: piiRedaction.input.entityTypes,
        language: piiRedaction.input.language,
        customPatterns: piiRedaction.input.customPatterns,
        onFailure: 'throw' as const,
      }
      processedInput = await redactLargeValueRefsInValue(processedInput, {
        ...inputOpts,
        store: {
          workspaceId: providedWorkspaceId,
          workflowId,
          executionId,
          userId: userId ?? undefined,
        },
      })
      processedInput = await redactObjectStrings(processedInput, inputOpts)
    }

    if (piiRedaction.blockOutputs.enabled) {
      // Resume / run-from-block restore prior block outputs into state. If those
      // predate the blockOutputs stage being enabled, re-mask them so downstream
      // blocks can't read unredacted PII from restored snapshot state. Masking is
      // idempotent, so outputs already masked in the original run are unaffected.
      //
      // Two disjoint passes cover the whole state: `redactLargeValueRefsInValue`
      // hydrates → masks → re-stores any value offloaded to large-value storage
      // (>8MB refs the string walk treats as opaque), then `redactObjectStrings`
      // masks the remaining inline string leaves. Both fail-fast (`throw`), so an
      // unmaskable restored value aborts the resume rather than warming raw PII
      // into `blockStates` for downstream blocks.
      const blockOutputOpts = {
        entityTypes: piiRedaction.blockOutputs.entityTypes,
        language: piiRedaction.blockOutputs.language,
        customPatterns: piiRedaction.blockOutputs.customPatterns,
        onFailure: 'throw' as const,
      }
      const largeRefOpts = {
        ...blockOutputOpts,
        store: {
          workspaceId: providedWorkspaceId,
          workflowId,
          executionId,
          userId: userId ?? undefined,
        },
      }
      if (snapshot.state?.blockStates) {
        const originalBlockStates = snapshot.state.blockStates
        const hydrated = await redactLargeValueRefsInValue(originalBlockStates, largeRefOpts)
        snapshot.state.blockStates = restoreBlockStateSecretProvenance(
          await redactObjectStrings(hydrated, blockOutputOpts),
          originalBlockStates
        )
      }
      if (runFromBlock?.sourceSnapshot?.blockStates) {
        const originalBlockStates = runFromBlock.sourceSnapshot.blockStates
        const hydrated = await redactLargeValueRefsInValue(originalBlockStates, largeRefOpts)
        runFromBlock.sourceSnapshot.blockStates = restoreBlockStateSecretProvenance(
          await redactObjectStrings(hydrated, blockOutputOpts),
          originalBlockStates
        )
      }
    }

    let startRunMetadata: StartBlockRunMetadata | undefined
    if (resolvedTriggerBlockId) {
      const entryBlock = serializedWorkflow.blocks.find(
        (block) => block.id === resolvedTriggerBlockId
      )
      if (entryBlock && isRunMetadataEnabled(entryBlock)) {
        startRunMetadata = {
          userEmail: await getUserEmailById(userId),
          workspaceId: providedWorkspaceId,
          workflowId,
          executionId,
          executionType: triggerType,
          executionMode: metadata.executionMode ?? 'sync',
          startTime: metadata.startTime,
        }
      }
    }

    const hasRestoredWorkflowInputProvenance =
      restoreTrusted &&
      restoredState !== undefined &&
      Object.hasOwn(restoredState, 'workflowInputResolvedSecretTraceProvenance')
    const restoredWorkflowInputProvenance = hasRestoredWorkflowInputProvenance
      ? isResolvedSecretTraceProvenanceV1(restoredState.workflowInputResolvedSecretTraceProvenance)
        ? restoredState.workflowInputResolvedSecretTraceProvenance
        : { version: 1 as const, complete: false, entries: [] }
      : undefined
    const workflowInputResolvedSecretTraceProvenance = restoredState
      ? restoredWorkflowInputProvenance
      : resolvedSecretTraceRegistry.exportCommittedProvenanceForValue(processedInput)

    const principalSubject = resolvePrincipalSubject(metadata.principal)
    const contextExtensions: ContextExtensions = {
      stream: !!onStream,
      selectedOutputs,
      executionId,
      largeValueExecutionIds,
      largeValueKeys,
      fileKeys,
      allowLargeValueWorkflowScope,
      workspaceId: providedWorkspaceId,
      userId,
      principal: metadata.principal,
      executorDelegationOrigin: {
        ...(principalSubject?.kind === 'sim_user'
          ? { subjectUserId: principalSubject.userId }
          : {}),
        workflowId,
        ...(executionId ? { executionId } : {}),
        principal: metadata.principal,
        currentWorkflow: deploymentVersionId
          ? { workflowId, mode: 'deployment', deploymentVersionId }
          : { workflowId, mode: 'draft' },
      },
      isDeployedContext: metadata.useDraftState !== true,
      enforceCredentialAccess: metadata.enforceCredentialAccess ?? false,
      piiBlockOutputRedaction: piiRedaction.blockOutputs,
      onBlockStart: wrappedOnBlockStart,
      onBlockComplete: wrappedOnBlockComplete,
      onStream,
      resumeFromSnapshot,
      resumePendingQueue,
      remainingEdges: snapshot.state?.remainingEdges?.map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
      })),
      dagIncomingEdges: snapshot.state?.dagIncomingEdges,
      snapshotState: snapshot.state,
      resolvedSecretTraceRegistry,
      ...(workflowInputResolvedSecretTraceProvenance
        ? { workflowInputResolvedSecretTraceProvenance }
        : {}),
      metadata,
      startRunMetadata,
      abortSignal,
      includeFileBase64,
      base64MaxBytes,
      stopAfterBlockId: resolvedStopAfterBlockId,
      onChildWorkflowInstanceReady,
      callChain: metadata.callChain,
      // The live block stream has a single known, authenticated Sim viewer only on
      // a client session — the execute route rejects `isClientSession` for API-key
      // and public-API callers, so it implies an authenticated session. Every other
      // surface (chat deployments, webhooks, schedules, background jobs) leaves this
      // unset, which is what keeps a custom block from streaming its SOURCE
      // workspace's block events to a consumer who may be an anonymous visitor.
      ...(metadata.isClientSession ? { liveTraceViewerUserId: userId } : {}),
      // The RAW callbacks, not the `wrapped*` composites above: these emit to the stream
      // without writing this run's progress markers. Only a custom block's child uses them.
      liveStreamCallbacks: { onBlockStart, onBlockComplete },
    }

    if (snapshot.state) {
      await warmLargeValueRefs(snapshot.state, {
        workspaceId: providedWorkspaceId,
        workflowId,
        executionId,
        largeValueExecutionIds,
        largeValueKeys,
        fileKeys,
        allowLargeValueWorkflowScope,
        userId,
      })
    }
    for (const variable of Object.values(workflowVariables)) {
      if (
        isPlainRecord(variable) &&
        variable.value !== undefined &&
        typeof variable.type === 'string'
      ) {
        variable.value = parseVariableValueByType(variable.value, variable.type)
      }
    }

    const executorInstance = new Executor({
      workflow: serializedWorkflow,
      envVarValues: decryptedEnvVars,
      workflowInput: processedInput,
      workflowVariables,
      contextExtensions,
    })

    const result = runFromBlock
      ? ((await executorInstance.executeFromBlock(
          workflowId,
          runFromBlock.startBlockId,
          runFromBlock.sourceSnapshot,
          runFromBlock.variableInputs
        )) as ExecutionResult)
      : ((await executorInstance.execute(workflowId, resolvedTriggerBlockId)) as ExecutionResult)

    await waitForLifecycleCallbacks()

    loggingSession.setPostExecutionPromise(
      (async () => {
        try {
          await finalizeExecutionOutcome({
            result,
            loggingSession,
            executionId,
            requestId,
            workflowInput: processedInput,
            abortSignal,
          })

          if (result.success && result.status !== 'paused') {
            try {
              await updateWorkflowRunCounts(workflowId)
            } catch (runCountError) {
              logger.error(`[${requestId}] Failed to update run counts`, { error: runCountError })
            }
          }
        } catch (postExecError) {
          logger.error(
            `[${requestId}] Post-execution logging failed`,
            loggingSession.projectDiagnosticError(postExecError, { executionId })
          )
        }
      })()
    )

    logger.info(`[${requestId}] Workflow execution completed`, {
      success: result.success,
      status: result.status,
      duration: result.metadata?.duration,
    })

    return result
  } catch (error: unknown) {
    const errorCause = describeErrorCause(error)
    logger.error(
      `[${requestId}] Execution failed:`,
      projectResolvedSecretDiagnosticError(
        error,
        resolvedSecretTraceRegistry,
        errorCause ? { cause: errorCause } : undefined
      )
    )

    await waitForLifecycleCallbacks()

    if (!loggingStarted) {
      loggingStarted = await loggingSession.safeStart({
        userId,
        billingAttribution: metadata.billingAttribution,
        workspaceId: providedWorkspaceId,
        variables: {},
        triggerData: metadata.correlation ? { correlation: metadata.correlation } : undefined,
        skipLogCreation,
        deploymentVersionId,
      })
    }

    loggingSession.setPostExecutionPromise(
      (async () => {
        try {
          const finalized = loggingStarted
            ? await finalizeExecutionError({
                error,
                loggingSession,
                executionId,
                requestId,
              })
            : false

          if (finalized) {
            markExecutionFinalizedByCore(error, executionId)
          }
        } catch (postExecError) {
          logger.error(
            `[${requestId}] Post-execution error logging failed`,
            loggingSession.projectDiagnosticError(postExecError, { executionId })
          )
        }
      })()
    )

    throw error
  }
}
