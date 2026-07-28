import { createLogger } from '@sim/logger'
import { findCause, getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { buildNextCallChain, validateCallChain } from '@/lib/execution/call-chain'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import { getUserEmailById } from '@/lib/users/queries'
import {
  admitCustomBlockChildExecution,
  buildCustomBlockCorrelation,
  createChildCancellationSignal,
} from '@/lib/workflows/custom-blocks/child-execution'
import { getCustomBlockAuthority } from '@/lib/workflows/custom-blocks/operations'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { type CustomBlockOutput, isCustomBlockType } from '@/blocks/custom/build-config'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType, DEFAULTS, HTTP } from '@/executor/constants'
import {
  BoundarySafeError,
  type CustomBlockErrorType,
  isBoundarySafeError,
} from '@/executor/errors/boundary'
import {
  ChildWorkflowError,
  formatWorkflowChainMessage,
} from '@/executor/errors/child-workflow-error'
import type { WorkflowNodeMetadata } from '@/executor/execution/types'
import {
  type BlockHandler,
  type ExecutionContext,
  type ExecutionResult,
  START_BLOCK_METADATA_FIELD,
  type StartBlockRunMetadata,
  type StreamingExecution,
} from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { buildAPIUrl, buildAuthHeaders } from '@/executor/utils/http'
import { getIterationContext } from '@/executor/utils/iteration-context'
import { parseJSON } from '@/executor/utils/json'
import { lazyCleanupInputMapping } from '@/executor/utils/lazy-cleanup'
import { isRunMetadataEnabled, resolveExecutorStartBlock } from '@/executor/utils/start-block'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WorkflowBlockHandler')

/**
 * Trigger recorded on a custom block child's own log row. Distinct from
 * `'workflow'` (which means "invoked by another workflow") so the publisher can
 * tell who used their block apart from their own nested runs.
 */
const CUSTOM_BLOCK_TRIGGER = 'custom_block'

/** Read a dot-path (e.g. `content.text`) out of a block output object. */
function getValueAtPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, source)
}

/**
 * Recover the trusted run metadata from the executing workflow's seeded
 * start-block output. Resume restores block states from the snapshot but never
 * rebuilds `ctx.startRunMetadata`, so the seeded output is the surviving copy.
 */
function readSeededStartRunMetadata(ctx: ExecutionContext): StartBlockRunMetadata | undefined {
  const resolution = resolveExecutorStartBlock(ctx.workflow?.blocks ?? [], {
    execution: 'manual',
    isChildWorkflow: false,
  })
  if (!resolution || !isRunMetadataEnabled(resolution.block)) return undefined

  const seeded = ctx.blockStates.get(resolution.blockId)?.output?.[START_BLOCK_METADATA_FIELD]
  return isRecordLike(seeded) ? (seeded as StartBlockRunMetadata) : undefined
}

/**
 * Remap a custom block's resolved input mapping from source-field ids to the
 * child workflow's current field names. The consumer's sub-block values are keyed
 * by the stable field id (so renames don't cook them); the child is addressed by
 * name. Legacy fields without an id are keyed by name and pass through unchanged.
 * Keys that match no current field are dropped.
 */
/**
 * Names of publisher-required custom block inputs the consumer left empty, checked
 * against the child's LIVE deployed Start fields — a required override whose field
 * was removed is inert, and a field added after publish has no override, so schema
 * drift can never block a run. `childWorkflowInput` is the post-remap mapping
 * (keyed by field name). Same empty semantics as the serializer's required check.
 */
export function findMissingRequiredCustomBlockInputs(
  requiredInputIds: string[],
  childBlocks: Record<string, unknown>,
  childWorkflowInput: Record<string, unknown>
): string[] {
  if (requiredInputIds.length === 0) return []
  const requiredIds = new Set(requiredInputIds)
  return extractInputFieldsFromBlocks(childBlocks)
    .filter((field) => requiredIds.has(field.id ?? field.name))
    .filter((field) => {
      const value = childWorkflowInput[field.name]
      return value === undefined || value === null || value === ''
    })
    .map((field) => field.name)
}

export function remapCustomBlockInputKeys(
  mapping: Record<string, unknown>,
  childBlocks: Record<string, unknown>
): Record<string, unknown> {
  const fields = extractInputFieldsFromBlocks(childBlocks)
  const remapped: Record<string, unknown> = {}
  for (const field of fields) {
    const key =
      field.id && field.id in mapping ? field.id : field.name in mapping ? field.name : null
    if (key === null) continue
    let value = mapping[key]
    // object/array inputs are authored in a JSON code editor, so their value is a
    // JSON *string*. Decode it against the child's real Start field type so the
    // child receives the actual object/array (or primitive) — not the string
    // re-encoded by the mapping's `JSON.stringify` (`"Theodore"` → `\"Theodore\"`).
    if ((field.type === 'object' || field.type === 'array') && typeof value === 'string') {
      try {
        value = JSON.parse(value)
      } catch {
        // Not valid JSON — pass the raw string through unchanged.
      }
    }
    remapped[field.name] = value
  }
  return remapped
}

type WorkflowTraceSpan = TraceSpan & {
  metadata?: Record<string, unknown>
  children?: WorkflowTraceSpan[]
  output?: (Record<string, unknown> & { childTraceSpans?: WorkflowTraceSpan[] }) | null
}

/**
 * Handler for workflow blocks that execute other workflows inline.
 * Creates sub-execution contexts and manages data flow between parent and child workflows.
 */
export class WorkflowBlockHandler implements BlockHandler {
  private serializer = new Serializer()

  canHandle(block: SerializedBlock): boolean {
    const id = block.metadata?.id
    return id === BlockType.WORKFLOW || id === BlockType.WORKFLOW_INPUT || isCustomBlockType(id)
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    return this.executeCore(ctx, block, inputs)
  }

  async executeWithNode(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: WorkflowNodeMetadata
  ): Promise<BlockOutput | StreamingExecution> {
    return this.executeCore(ctx, block, inputs, nodeMetadata)
  }

  private async executeCore(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata?: WorkflowNodeMetadata
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    const blockTypeId = block.metadata?.id
    const isCustomBlock = isCustomBlockType(blockTypeId)

    // Custom (deploy-as-block) blocks are an invocation boundary: resolve the bound
    // workflow + authority from the DB (never trust the serialized value) and run the
    // source workflow's LATEST deployment under its OWNER's authority — the same
    // identity a normal deployed API/schedule/webhook run uses — so a cross-workspace
    // consumer needs no permission on the source workflow. Owner deletion cascade-
    // deletes the workflow → the custom_block row, so the block never orphans.
    let workflowId = inputs.workflowId
    let loadUserId = ctx.userId
    let exposedOutputs: CustomBlockOutput[] = []
    let requiredInputIds: string[] = []
    if (isCustomBlock) {
      const authority = await getCustomBlockAuthority(blockTypeId as string, ctx.workspaceId)
      if (!authority) {
        throw new BoundarySafeError({
          errorType: 'unavailable',
          message: 'This custom block is no longer available',
        })
      }
      workflowId = authority.workflowId
      loadUserId = authority.ownerUserId
      exposedOutputs = authority.exposedOutputs
      requiredInputIds = authority.requiredInputIds
    }

    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    // Always run the latest deployment for custom blocks, even from a draft-context parent run.
    const useDeployed = isCustomBlock || ctx.isDeployedContext

    let childWorkflowName = workflowId

    // Unique ID per invocation — used to correlate child block events with this specific
    // workflow block execution, preventing cross-iteration child mixing in loop contexts.
    const instanceId = generateId()

    const childCallChain = buildNextCallChain(ctx.callChain || [], workflowId)
    const depthError = validateCallChain(childCallChain)
    if (depthError) {
      // The depth message names nothing about the source, so it is consumer-safe
      // for a custom block too — but `childWorkflowName` is still the source
      // workflow id at this point, so a custom block must carry its own block
      // name instead of leaking that id across the invocation boundary.
      throw new ChildWorkflowError({
        message: depthError,
        childWorkflowName: isCustomBlock
          ? block.metadata?.name || 'Custom block'
          : childWorkflowName,
        childWorkflowInstanceId: instanceId,
        ...(isCustomBlock
          ? { consumerFacing: { errorType: 'depth_limit' as const, message: depthError } }
          : {}),
      })
    }

    let childWorkflowSnapshotId: string | undefined
    /** Set for custom blocks only: the child's own execution id / log row. */
    let childExecutionId: string | undefined
    let childSession: LoggingSession | undefined
    let childSessionStarted = false
    let childCancellation: { signal: AbortSignal; dispose: () => void } | undefined
    try {
      // A custom block runs the source's latest deployment; if the source has been
      // undeployed there's nothing to run. `BoundarySafeError` marks the message as
      // safe to cross the invocation boundary verbatim (it names no source
      // internals), so the catch forwards it instead of the generic failure.
      if (isCustomBlock) {
        const deployed = await this.checkChildDeployment(workflowId, loadUserId)
        if (!deployed) {
          throw new BoundarySafeError({
            errorType: 'not_deployed',
            message: 'This block’s workflow is not deployed. Redeploy it to use this block.',
          })
        }
      }

      if (useDeployed && !isCustomBlock) {
        const hasActiveDeployment = await this.checkChildDeployment(workflowId, loadUserId)
        if (!hasActiveDeployment) {
          throw new Error(
            `Child workflow is not deployed. Please deploy the workflow before invoking it.`
          )
        }
      }

      const childWorkflow = useDeployed
        ? await this.loadChildWorkflowDeployed(workflowId, loadUserId)
        : await this.loadChildWorkflow(workflowId, ctx.userId)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      // Custom blocks are org-scoped and deliberately cross-workspace: the source
      // workflow lives in the publisher's workspace, not the consumer's. Their
      // boundary is the org overlay + `getCustomBlockAuthority`, so the
      // same-workspace assert (which guards regular workflow blocks) must be
      // skipped or every custom-block invocation from another workspace throws.
      if (!isCustomBlock) {
        this.assertChildWorkflowInWorkspace(workflowId, childWorkflow.workspaceId, ctx.workspaceId)
      }

      childWorkflowName = childWorkflow.name || 'Unknown Workflow'

      logger.info(
        `Executing child workflow: ${childWorkflowName} (${workflowId}), call chain depth ${ctx.callChain?.length || 0}`
      )

      let childWorkflowInput: Record<string, any> = {}

      if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
        const normalized = parseJSON(inputs.inputMapping, inputs.inputMapping)

        if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
          // Custom blocks key their mapping by the source field's stable id so a
          // rename never orphans the consumer's value; remap id → current name
          // before the child (which is addressed by name) receives it.
          const remapped = isCustomBlock
            ? remapCustomBlockInputKeys(
                normalized as Record<string, unknown>,
                childWorkflow.rawBlocks || {}
              )
            : (normalized as Record<string, unknown>)

          const cleanedMapping = await lazyCleanupInputMapping(
            ctx.workflowId || 'unknown',
            block.id,
            remapped,
            childWorkflow.rawBlocks || {}
          )
          childWorkflowInput = cleanedMapping as Record<string, any>
        } else {
          childWorkflowInput = {}
        }
      } else if (inputs.input !== undefined) {
        childWorkflowInput = inputs.input
      }

      if (isCustomBlock) {
        const missing = findMissingRequiredCustomBlockInputs(
          requiredInputIds,
          childWorkflow.rawBlocks || {},
          childWorkflowInput
        )
        if (missing.length > 0) {
          throw new BoundarySafeError({
            errorType: 'missing_inputs',
            message: `${block.metadata?.name || 'Custom block'} is missing required fields: ${missing.join(', ')}`,
          })
        }
      }

      const childSnapshotResult = await snapshotService.createSnapshotWithDeduplication(
        workflowId,
        childWorkflow.workflowState
      )
      childWorkflowSnapshotId = childSnapshotResult.snapshot.id

      const childDepth = (ctx.childWorkflowContext?.depth ?? 0) + 1
      // A custom block is an invocation boundary: forwarding the consumer's SSE
      // callbacks into the source run would stream the publisher's block names,
      // inputs, outputs, and raw agent tokens to the consumer's browser — where
      // the terminal silently drops them, so the leak is invisible in the UI.
      const shouldPropagateCallbacks = !isCustomBlock && childDepth <= DEFAULTS.MAX_SSE_CHILD_DEPTH

      if (!shouldPropagateCallbacks && !isCustomBlock) {
        logger.info('Dropping SSE callbacks beyond max child depth', {
          childDepth,
          maxDepth: DEFAULTS.MAX_SSE_CHILD_DEPTH,
          childWorkflowName,
        })
      }

      if (shouldPropagateCallbacks) {
        const effectiveBlockId = nodeMetadata
          ? (nodeMetadata.originalBlockId ?? nodeMetadata.nodeId)
          : block.id
        const iterationContext = nodeMetadata ? getIterationContext(ctx, nodeMetadata) : undefined
        await ctx.onChildWorkflowInstanceReady?.(
          effectiveBlockId,
          instanceId,
          iterationContext,
          nodeMetadata?.executionOrder,
          ctx.childWorkflowContext
        )
      }

      // A custom block is an invocation boundary: the child runs under the SOURCE
      // workflow owner's identity, workspace, and environment — not the consumer's —
      // so it resolves credentials/integrations/env exactly as published and the
      // consumer needs no access to any of them. Billing follows the same boundary:
      // the child opens its own logging session against the source workspace, whose
      // payer is charged for everything it spends. Regular workflow blocks keep
      // running in the parent's context.
      let childUserId = ctx.userId
      let childWorkspaceId = ctx.workspaceId
      let childEnvVarValues = ctx.environmentVariables
      let childBillingAttribution = ctx.metadata.billingAttribution
      let childEnvVariablesForLogging = ctx.environmentVariables
      if (isCustomBlock) {
        if (!loadUserId) {
          throw new Error('Custom block source workflow has no owner')
        }
        if (!childWorkflow.workspaceId) {
          throw new Error('Custom block source workflow has no workspace')
        }
        childUserId = loadUserId
        childWorkspaceId = childWorkflow.workspaceId
        const ownerEnv = await getPersonalAndWorkspaceEnv(loadUserId, childWorkflow.workspaceId)
        childEnvVarValues = { ...ownerEnv.personalDecrypted, ...ownerEnv.workspaceDecrypted }
        childEnvVariablesForLogging = {
          ...ownerEnv.personalEncrypted,
          ...ownerEnv.workspaceEncrypted,
        }
        // Custom-block children authenticate internal tool calls as the source
        // owner in the source workspace, so the consumer's snapshot would fail
        // the internal routes' actor/workspace scope match. Resolve the
        // source-scoped payer instead — the same decision those routes made
        // themselves before attribution headers became required.
        childBillingAttribution = await resolveBillingAttribution({
          actorUserId: loadUserId,
          workspaceId: childWorkflow.workspaceId,
        })
        // Admit against the source payer before any spend. No reservation — see
        // `admitCustomBlockChildExecution`.
        await admitCustomBlockChildExecution(childBillingAttribution)
      }

      // Trusted run metadata for the child's Start block. Every field describes
      // the INVOKING run (the caller's email, workspace, and workflow — never the
      // child's own static, authoring-time-known identity), delivered on a
      // server-verified channel a consumer's inputs can never spoof.
      let childStartRunMetadata: StartBlockRunMetadata | undefined
      const childStartResolution = resolveExecutorStartBlock(childWorkflow.serializedState.blocks, {
        execution: 'manual',
        isChildWorkflow: false,
      })
      // Resumed executions never rebuild `ctx.startRunMetadata`, so fall back to
      // the parent's own seeded start-block output — the persisted copy of the
      // same trusted object, restored from the snapshot on resume.
      const inherited = ctx.startRunMetadata ?? readSeededStartRunMetadata(ctx)
      if (childStartResolution && isRunMetadataEnabled(childStartResolution.block)) {
        // When the parent run already carries trusted metadata, propagate ALL of
        // it so nested children see one consistent invoking identity (the
        // original consumer) instead of a mix of original and intermediate.
        // Inherited email is taken verbatim — a fail-soft null must stay null,
        // not be re-resolved to the intermediate (publisher) identity.
        childStartRunMetadata = {
          userEmail: inherited
            ? (inherited.userEmail ?? null)
            : ctx.userId
              ? await getUserEmailById(ctx.userId)
              : null,
          workspaceId: inherited?.workspaceId ?? ctx.workspaceId ?? null,
          workflowId: inherited?.workflowId ?? ctx.workflowId ?? null,
          executionId: ctx.executionId,
          executionType: 'workflow',
          executionMode: inherited?.executionMode ?? ctx.metadata.executionMode,
          startTime: new Date().toISOString(),
        }
      }

      // A custom block's child is its own execution: its own id (the log row's
      // `execution_id` is unique), its own logging session against the SOURCE
      // workspace, and its own ledger rows. Everything below that differs from a
      // regular workflow block follows from that.
      if (isCustomBlock) {
        childExecutionId = generateId()
        childSession = new LoggingSession(
          workflowId,
          childExecutionId,
          CUSTOM_BLOCK_TRIGGER,
          ctx.metadata.requestId,
          childExecutionId,
          // The consumer already pays one execution fee for the invoking run; the
          // child is part of that same logical run and must not add a second.
          { baseExecutionCharge: 0 }
        )
        childSessionStarted = await childSession.safeStart({
          userId: childUserId,
          actorUserId: childUserId,
          billingAttribution: childBillingAttribution,
          workspaceId: childWorkspaceId,
          variables: childEnvVariablesForLogging,
          workflowState: childWorkflow.workflowState,
          triggerData: (() => {
            const correlation = buildCustomBlockCorrelation({
              invokerExecutionId: ctx.executionId,
              invokerRequestId: ctx.metadata.requestId,
              invokerWorkflowId: ctx.workflowId,
              invokerWorkspaceId: ctx.workspaceId,
              blockType: blockTypeId as string,
            })
            return correlation ? { correlation } : undefined
          })(),
        })
        if (!childSessionStarted) {
          logger.error('Custom block child logging failed to start; child spend will be unbilled', {
            workflowId,
            childExecutionId,
          })
        }
        // The child no longer shares the parent's execution id, so it no longer
        // hears the parent's cancellation event — bridge it explicitly.
        childCancellation = createChildCancellationSignal({
          parentSignal: ctx.abortSignal,
          parentExecutionId: ctx.executionId,
        })
        // Large values are scoped by execution id, so the parent must be able to
        // read a large exposed output the child produced.
        ctx.largeValueExecutionIds = Array.from(
          new Set([...(ctx.largeValueExecutionIds ?? []), childExecutionId])
        )
      }

      const activeSession = childSession
      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: childWorkflowInput,
        envVarValues: childEnvVarValues,
        workflowVariables: childWorkflow.variables || {},
        contextExtensions: {
          isChildExecution: true,
          // Custom blocks always run the source's latest deployment, so the child
          // context must be deployed too — otherwise its metadata treats the
          // deployed graph as draft. `useDeployed` folds in the custom-block case.
          isDeployedContext: useDeployed,
          enforceCredentialAccess: ctx.enforceCredentialAccess,
          workspaceId: childWorkspaceId,
          userId: childUserId,
          executionId: childExecutionId ?? ctx.executionId,
          // Large values are cached per execution id, so a child running under its
          // own id still needs the invoking run's id to read values in its inputs.
          ...(childExecutionId
            ? {
                largeValueExecutionIds: Array.from(
                  new Set([
                    ...(ctx.executionId ? [ctx.executionId] : []),
                    ...(ctx.largeValueExecutionIds ?? []),
                  ])
                ),
              }
            : {}),
          // Same-workspace children share the parent's frozen payer decision so
          // internal tool calls (knowledge, guardrails, MCP, Mothership) can
          // attach the required billing attribution header.
          billingAttribution: childBillingAttribution,
          // Fall back to the inherited metadata so a toggle-off intermediate
          // child still carries the trusted identity chain to deeper children.
          startRunMetadata: childStartRunMetadata ?? inherited,
          abortSignal: childCancellation?.signal ?? ctx.abortSignal,
          // Propagate in-flight block-output redaction into child workflows so
          // nested blocks mask outputs too (recurses: each child forwards it).
          piiBlockOutputRedaction: ctx.piiBlockOutputRedaction,
          callChain: childCallChain,
          // A custom block's block markers belong to ITS OWN session — the
          // parent's callbacks are bound to the consumer's logging session and
          // would both leak the source's block names and clobber its progress.
          ...(activeSession && childSessionStarted
            ? {
                onBlockStart: async (blockId: string, blockName: string, blockType: string) => {
                  try {
                    await activeSession.onBlockStart(
                      blockId,
                      blockName,
                      blockType,
                      new Date().toISOString()
                    )
                  } catch {
                    // A progress marker must never fail the block it describes.
                  }
                },
                onBlockComplete: async (
                  blockId: string,
                  blockName: string,
                  blockType: string,
                  output: unknown
                ) => {
                  try {
                    await activeSession.onBlockComplete(blockId, blockName, blockType, output)
                  } catch {
                    // A progress marker must never fail the block it describes.
                  }
                },
              }
            : {}),
          ...(shouldPropagateCallbacks && {
            onBlockStart: ctx.onBlockStart,
            onBlockComplete: ctx.onBlockComplete,
            onStream: ctx.onStream,
            onChildWorkflowInstanceReady: ctx.onChildWorkflowInstanceReady,
            childWorkflowContext: {
              parentBlockId: instanceId,
              workflowName: childWorkflowName,
              workflowId,
              depth: childDepth,
            },
          }),
        },
      })

      const startTime = performance.now()

      const result = await subExecutor.execute(workflowId)
      const executionResult = this.toExecutionResult(result)
      const duration = performance.now() - startTime

      if (childSession && childSessionStarted) {
        await this.finalizeChildSession(childSession, executionResult, duration, childWorkflowInput)
      }

      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`, {
        success: executionResult.success,
        hasLogs: (executionResult.logs?.length ?? 0) > 0,
      })

      // A custom block's spans never reach the parent — they belong to the child's
      // own log row in the source workspace — so don't build them here at all.
      const childTraceSpans = isCustomBlock
        ? []
        : this.captureChildWorkflowLogs(executionResult, childWorkflowName, ctx)

      const mappedResult = this.mapChildOutputToParent(
        executionResult,
        workflowId,
        childWorkflowName,
        duration,
        instanceId,
        childTraceSpans,
        childWorkflowSnapshotId
      )

      // Custom blocks expose only curated outputs — never the child workflow id,
      // name, trace spans, or cost. `mapChildOutputToParent` above still runs so
      // failures surface identically; we just reshape the successful output. The
      // child's spend is billed by its own session, not rolled onto this block.
      if (isCustomBlock) {
        return this.projectCustomBlockOutput(executionResult, exposedOutputs)
      }

      return mappedResult
    } catch (error: unknown) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

      // The child's own log row records the real failure in the source workspace,
      // so the publisher sees what the consumer deliberately cannot.
      if (childSession && childSessionStarted) {
        await this.failChildSession(childSession, error)
      }

      // An error this same invocation already attributed (e.g. the depth guard, or
      // `mapChildOutputToParent`) is rethrown untouched — re-wrapping it would
      // duplicate this workflow in the chain.
      if (
        ChildWorkflowError.isChildWorkflowError(error) &&
        error.childWorkflowInstanceId === instanceId
      ) {
        throw error
      }

      if (isCustomBlock) {
        throw this.buildBoundaryFailure(error, block, instanceId, childExecutionId)
      }

      let childTraceSpans: WorkflowTraceSpan[] = []
      let executionResult: ExecutionResult | undefined

      if (hasExecutionResult(error) && error.executionResult.logs) {
        executionResult = error.executionResult

        logger.info(`Extracting child trace spans from error.executionResult`, {
          hasLogs: (executionResult.logs?.length ?? 0) > 0,
          logCount: executionResult.logs?.length ?? 0,
        })

        childTraceSpans = this.captureChildWorkflowLogs(executionResult, childWorkflowName, ctx)

        logger.info(`Captured ${childTraceSpans.length} child trace spans from failed execution`)
      } else if (ChildWorkflowError.isChildWorkflowError(error)) {
        childTraceSpans = error.childTraceSpans
      }

      const { chain, rootErrorMessage } = this.buildChildFailure(childWorkflowName, error)

      throw new ChildWorkflowError({
        message: formatWorkflowChainMessage(chain, rootErrorMessage),
        childWorkflowName,
        workflowChain: chain,
        rootErrorMessage,
        childTraceSpans,
        executionResult,
        childWorkflowSnapshotId,
        childWorkflowInstanceId: instanceId,
        cause: error instanceof Error ? error : undefined,
      })
    } finally {
      // A custom block inside a loop would otherwise leak one abort listener and
      // one cancellation subscription per iteration.
      childCancellation?.dispose()
    }
  }

  /**
   * Completes a custom-block child's own logging session, so the publisher gets a
   * full run record — trace waterfall, duration, and ledger rows — in the source
   * workspace. A paused child goes through the normal completion path rather than
   * `safeCompleteWithPause`: a nested child has no resume path, and the pause path
   * deliberately skips the reservation release, which would strand a pending row.
   */
  private async finalizeChildSession(
    session: LoggingSession,
    executionResult: ExecutionResult,
    durationMs: number,
    workflowInput: Record<string, any>
  ): Promise<void> {
    const { traceSpans, totalDuration } = buildTraceSpans(executionResult)
    const endedAt = new Date().toISOString()
    const totalDurationMs = totalDuration ?? Math.round(durationMs)

    if (executionResult.metadata?.status === 'cancelled') {
      await session.safeCompleteWithCancellation({ endedAt, totalDurationMs, traceSpans })
      return
    }

    await session.safeComplete({
      endedAt,
      totalDurationMs,
      finalOutput: executionResult.output ?? {},
      traceSpans,
      workflowInput,
    })
  }

  /** Records a custom-block child's failure on its own log row. */
  private async failChildSession(session: LoggingSession, error: unknown): Promise<void> {
    const normalized = toError(error)
    const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
    const { traceSpans, totalDuration } = executionResult
      ? buildTraceSpans(executionResult)
      : { traceSpans: [], totalDuration: 0 }

    await session.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration ?? 0,
      error: { message: normalized.message, stackTrace: normalized.stack },
      traceSpans,
    })
  }

  /**
   * The consumer-facing failure for a custom block. The invocation boundary means
   * the consumer must never see the source workflow's name, its nested error text
   * (which names internal blocks), its trace spans, or its execution result — the
   * success path hides all of these too. The real error is logged for the
   * publisher, and the child's own log row carries the full detail.
   *
   * A `BoundarySafeError` names only the caller's own artifacts, so its message
   * crosses verbatim. Everything else collapses to a generic failure: the default
   * is fail-closed, so a `throw` added later is redacted automatically. Deliberately
   * sets no `cause` — that is what severs the error chain at the trust boundary.
   */
  private buildBoundaryFailure(
    error: unknown,
    block: SerializedBlock,
    instanceId: string,
    childExecutionId: string | undefined
  ): ChildWorkflowError {
    const blockName = block.metadata?.name || 'Custom block'
    const safe = isBoundarySafeError(error) ? error : undefined
    const errorType: CustomBlockErrorType = safe?.errorType ?? 'execution_failed'
    // The ref is the child run's own execution id — opaque to the consumer, and
    // the handle a publisher needs to find the exact failing run in their logs.
    const ref = safe ? undefined : childExecutionId
    const message = safe
      ? safe.message
      : ref
        ? `Custom block execution failed (ref: ${ref})`
        : 'Custom block execution failed'

    return new ChildWorkflowError({
      message,
      childWorkflowName: blockName,
      childWorkflowInstanceId: instanceId,
      consumerFacing: { errorType, ...(ref ? { ref } : {}), message },
    })
  }

  /**
   * The workflow chain and root error for a nested failure, recovered from the
   * structured fields on a wrapped {@link ChildWorkflowError} rather than by
   * parsing its formatted message.
   */
  private buildChildFailure(
    childWorkflowName: string,
    error: unknown
  ): { chain: string[]; rootErrorMessage: string } {
    const nested = findCause(error, ChildWorkflowError.isChildWorkflowError)
    if (nested) {
      return {
        chain: [childWorkflowName, ...nested.workflowChain],
        rootErrorMessage: nested.rootErrorMessage,
      }
    }
    return {
      chain: [childWorkflowName],
      rootErrorMessage: getErrorMessage(error, 'Unknown error'),
    }
  }

  /**
   * Ensures the child workflow belongs to the same workspace as the executing
   * context before any child execution starts. Blocks silent cross-workspace
   * execution (e.g. a manual workflow id still pointing at the source
   * workspace after a fork), which would otherwise run the foreign workflow
   * with the parent workspace's environment and billing. Fails closed when the
   * executing context carries no workspace id: every server execution path
   * populates it via execution-core, so a missing value indicates a context
   * that must not silently bypass the check. The error message intentionally
   * omits the foreign workspace id.
   */
  private assertChildWorkflowInWorkspace(
    childWorkflowId: string,
    childWorkspaceId: string | null | undefined,
    parentWorkspaceId: string | undefined
  ): void {
    if (!parentWorkspaceId) {
      throw new Error(
        `Cannot execute child workflow ${childWorkflowId}: executing context has no workspace`
      )
    }
    if (childWorkspaceId !== parentWorkspaceId) {
      throw new Error(
        `Child workflow ${childWorkflowId} belongs to a different workspace and cannot be executed`
      )
    }
  }

  private async loadChildWorkflow(workflowId: string, userId?: string) {
    const headers = await buildAuthHeaders(userId)
    const url = buildAPIUrl(`/api/workflows/${workflowId}`)

    const response = await fetch(url.toString(), { headers })

    if (!response.ok) {
      await response.text().catch(() => {})
      if (response.status === HTTP.STATUS.NOT_FOUND) {
        logger.warn(`Child workflow ${workflowId} not found`)
        return null
      }
      throw new Error(`Failed to fetch workflow: ${response.status} ${response.statusText}`)
    }

    const { data: workflowData } = await response.json()

    if (!workflowData) {
      throw new Error(`Child workflow ${workflowId} returned empty data`)
    }

    logger.info(`Loaded child workflow: ${workflowData.name} (${workflowId})`)
    const workflowState = workflowData.state

    if (!workflowState || !workflowState.blocks) {
      throw new Error(`Child workflow ${workflowId} has invalid state`)
    }

    const serializedWorkflow = this.serializer.serializeWorkflow(
      workflowState.blocks,
      workflowState.edges || [],
      workflowState.loops || {},
      workflowState.parallels || {},
      true
    )

    const workflowVariables = (workflowData.variables as Record<string, any>) || {}
    const workflowStateWithVariables = {
      ...workflowState,
      variables: workflowVariables,
      metadata: {
        ...(workflowState.metadata || {}),
        name: workflowData.name || DEFAULTS.WORKFLOW_NAME,
      },
    }

    if (Object.keys(workflowVariables).length > 0) {
      logger.info(
        `Loaded ${Object.keys(workflowVariables).length} variables for child workflow: ${workflowId}`
      )
    }

    return {
      name: workflowData.name,
      workspaceId: (workflowData.workspaceId ?? null) as string | null,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: workflowState.blocks,
    }
  }

  private async checkChildDeployment(workflowId: string, userId?: string): Promise<boolean> {
    try {
      const headers = await buildAuthHeaders(userId)
      const url = buildAPIUrl(`/api/workflows/${workflowId}/deployed`)

      const response = await fetch(url.toString(), {
        headers,
        cache: 'no-store',
      })

      if (!response.ok) return false

      const json = await response.json()
      return !!json?.data?.deployedState || !!json?.deployedState
    } catch (e) {
      logger.error(`Failed to check child deployment for ${workflowId}:`, e)
      return false
    }
  }

  private async loadChildWorkflowDeployed(workflowId: string, userId?: string) {
    const headers = await buildAuthHeaders(userId)
    const deployedUrl = buildAPIUrl(`/api/workflows/${workflowId}/deployed`)

    const deployedRes = await fetch(deployedUrl.toString(), {
      headers,
      cache: 'no-store',
    })

    if (!deployedRes.ok) {
      if (deployedRes.status === HTTP.STATUS.NOT_FOUND) {
        return null
      }
      throw new Error(
        `Failed to fetch deployed workflow: ${deployedRes.status} ${deployedRes.statusText}`
      )
    }
    const deployedJson = await deployedRes.json()
    const deployedState = deployedJson?.data?.deployedState || deployedJson?.deployedState
    if (!deployedState || !deployedState.blocks) {
      throw new Error(`Deployed state missing or invalid for child workflow ${workflowId}`)
    }

    const metaUrl = buildAPIUrl(`/api/workflows/${workflowId}`)
    const metaRes = await fetch(metaUrl.toString(), {
      headers,
      cache: 'no-store',
    })

    if (!metaRes.ok) {
      throw new Error(`Failed to fetch workflow metadata: ${metaRes.status} ${metaRes.statusText}`)
    }
    const metaJson = await metaRes.json()
    const wfData = metaJson?.data

    const serializedWorkflow = this.serializer.serializeWorkflow(
      deployedState.blocks,
      deployedState.edges || [],
      deployedState.loops || {},
      deployedState.parallels || {},
      true
    )

    const workflowVariables = (wfData?.variables as Record<string, any>) || {}
    const childName = wfData?.name || DEFAULTS.WORKFLOW_NAME
    const workflowStateWithVariables = {
      ...deployedState,
      variables: workflowVariables,
      metadata: {
        ...(deployedState.metadata || {}),
        name: childName,
      },
    }

    return {
      name: childName,
      workspaceId: (wfData?.workspaceId ?? null) as string | null,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: deployedState.blocks,
    }
  }

  /**
   * Captures and transforms child workflow logs into trace spans
   */
  private captureChildWorkflowLogs(
    childResult: ExecutionResult,
    childWorkflowName: string,
    parentContext: ExecutionContext
  ): WorkflowTraceSpan[] {
    try {
      if (!childResult.logs || !Array.isArray(childResult.logs)) {
        return []
      }

      const { traceSpans } = buildTraceSpans(childResult)

      if (!traceSpans || traceSpans.length === 0) {
        return []
      }

      const processedSpans = this.processChildWorkflowSpans(traceSpans)

      if (processedSpans.length === 0) {
        return []
      }

      const transformedSpans = processedSpans.map((span) =>
        this.transformSpanForChildWorkflow(span, childWorkflowName)
      )

      return transformedSpans
    } catch (error) {
      logger.error(`Error capturing child workflow logs for ${childWorkflowName}:`, error)
      return []
    }
  }

  private transformSpanForChildWorkflow(
    span: WorkflowTraceSpan,
    childWorkflowName: string
  ): WorkflowTraceSpan {
    const metadata: Record<string, unknown> = {
      ...(span.metadata ?? {}),
      isFromChildWorkflow: true,
      childWorkflowName,
    }

    const transformedChildren = Array.isArray(span.children)
      ? span.children.map((childSpan) =>
          this.transformSpanForChildWorkflow(childSpan, childWorkflowName)
        )
      : undefined

    return {
      ...span,
      metadata,
      ...(transformedChildren ? { children: transformedChildren } : {}),
    }
  }

  private processChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const processed: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (span.children && Array.isArray(span.children)) {
          processed.push(...this.processChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        workflowSpan.children = this.processChildWorkflowSpans(workflowSpan.children as TraceSpan[])
      }

      processed.push(workflowSpan)
    })

    return processed
  }

  private toExecutionResult(result: ExecutionResult | StreamingExecution): ExecutionResult {
    return 'execution' in result ? result.execution : result
  }

  private isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
    if (!span || span.type !== 'workflow') return false
    return !span.blockId
  }

  /**
   * Shape a custom block's successful output. With curated `exposedOutputs`, each
   * maps a child block output (blockId + dot-path, read from the child's per-block
   * logs) to a named top-level field. With none, exposes the child's whole
   * `result`. Never leaks child workflow id/name/trace spans — nor its cost, which
   * is billed to the source workspace by the child's own logging session.
   */
  private projectCustomBlockOutput(
    executionResult: ExecutionResult,
    exposedOutputs: CustomBlockOutput[]
  ): BlockOutput {
    if (exposedOutputs.length === 0) {
      return { success: true, result: executionResult.output ?? {} }
    }
    const logs = executionResult.logs ?? []
    const output: Record<string, unknown> = {}
    for (const { blockId, path, name } of exposedOutputs) {
      const log =
        [...logs].reverse().find((l) => l.blockId === blockId && l.success) ??
        [...logs].reverse().find((l) => l.blockId === blockId)
      output[name] = log ? getValueAtPath(log.output, path) : undefined
    }
    // System fields spread last — pre-validation rows may still name an output success.
    return { ...output, success: true } as BlockOutput
  }

  private mapChildOutputToParent(
    childResult: ExecutionResult,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number,
    instanceId: string,
    childTraceSpans?: WorkflowTraceSpan[],
    childWorkflowSnapshotId?: string
  ): BlockOutput {
    const success = childResult.success !== false
    const result = childResult.output || {}

    if (!success) {
      logger.warn(`Child workflow ${childWorkflowName} failed`)
      const rootErrorMessage = childResult.error || 'Child workflow execution failed'
      const chain = [childWorkflowName]
      throw new ChildWorkflowError({
        message: formatWorkflowChainMessage(chain, rootErrorMessage),
        childWorkflowName,
        workflowChain: chain,
        rootErrorMessage,
        childTraceSpans: childTraceSpans || [],
        childWorkflowSnapshotId,
        childWorkflowInstanceId: instanceId,
      })
    }

    const output: BlockOutput = {
      success: true,
      childWorkflowName,
      childWorkflowId,
      ...(childWorkflowSnapshotId ? { childWorkflowSnapshotId } : {}),
      result,
      childTraceSpans: childTraceSpans || [],
      _childWorkflowInstanceId: instanceId,
    }
    return output
  }
}
