import type { Context } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import {
  type AttributedBillingRequestEnvelope,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  createAttributedBillingRequestEnvelope,
} from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { isCopilotToolPermissionsEnabled, isHosted } from '@/lib/core/config/env-flags'
import type { AsyncCompletionSignal } from '@/lib/mothership/async-runs/lifecycle'
import { createRunSegment, updateRunStatus } from '@/lib/mothership/async-runs/repository'
import { TOOL_WATCHDOG_RESUME_GRACE_MS } from '@/lib/mothership/constants'
import {
  type CopilotEnvironmentContext,
  prepareCopilotEnvironmentContext,
} from '@/lib/mothership/environment-context'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { StreamResponseReceipt } from '@/lib/mothership/generated/protocol'
import { CopilotDegradedReason } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { getAutoAllowedTools } from '@/lib/mothership/persistence/tool-permission/auto-allow'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/mothership/request/context/result'
import { resolveEnterpriseByokKey } from '@/lib/mothership/request/enterprise-byok'
import {
  BillingLimitError,
  CopilotBackendError,
  runStreamLoop,
} from '@/lib/mothership/request/go/stream'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { StreamRetryWindow } from '@/lib/mothership/request/lifecycle/stream-retry'
import { recordDegraded } from '@/lib/mothership/request/metrics'
import { AbortReason } from '@/lib/mothership/request/session/abort-reason'
import {
  getToolCallTerminalData,
  requireToolCallStateResult,
  setTerminalToolCallState,
} from '@/lib/mothership/request/tool-call-state'
import { handleBillingLimitResponse } from '@/lib/mothership/request/tools/billing'
import {
  executeToolAndReport,
  failPendingToolCall,
  pendingToolWaitBudgetMs,
} from '@/lib/mothership/request/tools/executor'
import type { TraceCollector } from '@/lib/mothership/request/trace'
import { RequestTraceV1SpanStatus } from '@/lib/mothership/request/trace'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  ResumeContinuation,
  ResumeFrame,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'
import type { SecretMountPolicy } from '@/lib/mothership/secret-mount-policy'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import { prepareExecutionContext } from '@/lib/mothership/tools/handlers/context'
import { filterModelSafeWorkspaceFileAttachments } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotLifecycle')

const MOTHERSHIP_CODE_TOOL_ROUTES = new Set([
  '/api/copilot',
  '/api/mothership',
  '/api/mothership/execute',
])

const COPILOT_MODEL_CONTENT_PROJECTION_ERROR = 'Copilot model input could not be safely projected'

class CopilotModelContentProjectionError extends Error {
  constructor() {
    super(COPILOT_MODEL_CONTENT_PROJECTION_ERROR)
    this.name = 'CopilotModelContentProjectionError'
  }
}

async function omitUnsafeInitialCopilotAttachments(
  payload: Record<string, unknown>,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  let projected = payload
  for (const key of ['attachments', 'fileAttachments'] as const) {
    if (!Object.hasOwn(projected, key)) continue
    const attachments = projected[key]
    if (!Array.isArray(attachments)) {
      refuseResolvedSecretProjection({
        site: 'copilot.initialAttachmentsShape',
        message: COPILOT_MODEL_CONTENT_PROJECTION_ERROR,
        inputPath: key,
        createError: () => new CopilotModelContentProjectionError(),
      })
    }

    let safeAttachments: unknown[]
    try {
      safeAttachments = await filterModelSafeWorkspaceFileAttachments(attachments, { workspaceId })
    } catch (error) {
      logger.error('Workspace file secret provenance could not be verified', {
        attachmentCount: attachments.length,
        error: toError(error).message,
      })
      refuseResolvedSecretProjection({
        site: 'copilot.initialAttachmentsProvenance',
        message: COPILOT_MODEL_CONTENT_PROJECTION_ERROR,
        inputPath: key,
        createError: () => new CopilotModelContentProjectionError(),
      })
    }

    if (safeAttachments.length === attachments.length) continue
    logger.warn('Omitting Copilot attachments with unsafe secret provenance', {
      attachmentCount: attachments.length,
      omittedCount: attachments.length - safeAttachments.length,
    })
    projected =
      safeAttachments.length > 0 ? { ...projected, [key]: safeAttachments } : omit(projected, [key])
  }
  return projected
}

async function ensureModelEgressRegistry(
  execContext: ExecutionContext,
  options: Pick<CopilotLifecycleOptions, 'environmentContext' | 'userId' | 'workspaceId'>
): Promise<ResolvedSecretTraceRegistry> {
  let registry = execContext.resolvedSecretTraceRegistry
  if (!registry) {
    const environmentContext =
      options.environmentContext ??
      (await prepareCopilotEnvironmentContext(options.userId, options.workspaceId))
    registry = environmentContext.resolvedSecretTraceRegistry
    execContext.resolvedSecretTraceRegistry = registry
  }
  return registry
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resultContent(context: StreamingContext, options: CopilotLifecycleOptions): string {
  if (options.interactive === false && context.sawMainToolCall) {
    return context.finalAssistantContent
  }
  return context.accumulatedContent
}

export interface CopilotLifecycleOptions extends OrchestratorOptions {
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  goRoute?: string
  trace?: TraceCollector
  simRequestId?: string
  otelContext?: Context
  onGoTraceId?: (goTraceId: string) => void
  executionContext?: ExecutionContext
  billingAttribution?: BillingAttributionSnapshot
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  environmentContext?: CopilotEnvironmentContext
  userPermission?: PermissionType
  secretMountPolicy?: SecretMountPolicy
  secretActorUserId?: string | null
}

/**
 * Seed the per-request tool permission state.
 *
 * This is the feature's single on-switch: everything downstream — stamping the
 * wire frame, holding the tool, drawing the card, persisting a decision — keys
 * off `enabled`, so a disabled request behaves exactly as it did before the
 * feature existed and never touches the preference tables.
 *
 * Beyond the flag, gating is limited to interactive mothership chats: that is
 * the only surface with a UI that can answer a prompt, so enabling it anywhere
 * else would hang the turn until the orchestration timeout with nothing to click.
 */
async function resolveToolPermissions(
  options: CopilotLifecycleOptions
): Promise<StreamingContext['toolPermissions']> {
  const enabled =
    isCopilotToolPermissionsEnabled &&
    options.interactive !== false &&
    (options.goRoute ?? '').startsWith('/api/mothership')
  if (!enabled) return { enabled: false, autoAllowed: new Set() }
  return { enabled: true, autoAllowed: await getAutoAllowedTools(options.userId, options.chatId) }
}

export async function runCopilotLifecycle(
  requestPayload: Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const {
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    goRoute = '/api/copilot',
  } = options
  const payloadMsgId =
    typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : generateId()
  const runIdentity = await ensureHeadlessRunIdentity({
    requestPayload,
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    messageId: payloadMsgId,
  })
  if (runIdentity.cancelled) {
    return { success: false, cancelled: true, content: '', contentBlocks: [], toolCalls: [] }
  }
  const resolvedExecutionId = runIdentity.executionId ?? executionId
  const resolvedRunId = runIdentity.runId ?? runId
  const ownedRunId = !runId && !executionId ? runIdentity.runId : undefined
  let terminalResult: OrchestratorResult | undefined
  try {
    const lifecycleOptions: CopilotLifecycleOptions = {
      ...options,
      executionId: resolvedExecutionId,
      runId: resolvedRunId,
      ...(options.executionContext
        ? {
            executionContext: {
              ...options.executionContext,
              messageId: payloadMsgId,
              executionId: resolvedExecutionId,
              runId: resolvedRunId,
              abortSignal: options.abortSignal,
              billingAttribution:
                options.billingAttribution ?? options.executionContext.billingAttribution,
              ...(options.userPermission ? { userPermission: options.userPermission } : {}),
              ...(options.resolvedSecretTraceRegistry
                ? { resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry }
                : {}),
              ...(options.secretMountPolicy
                ? { secretMountPolicy: options.secretMountPolicy }
                : {}),
              ...(options.secretActorUserId !== undefined
                ? { secretActorUserId: options.secretActorUserId }
                : {}),
            },
          }
        : {}),
    }

    const execContext =
      lifecycleOptions.executionContext ??
      (await buildExecutionContext(requestPayload, {
        userId,
        workflowId,
        workspaceId,
        chatId,
        executionId: resolvedExecutionId,
        runId: resolvedRunId,
        abortSignal: lifecycleOptions.abortSignal,
        billingAttribution: lifecycleOptions.billingAttribution,
        resolvedSecretTraceRegistry: lifecycleOptions.resolvedSecretTraceRegistry,
        environmentContext: lifecycleOptions.environmentContext,
        userPermission: lifecycleOptions.userPermission,
        secretMountPolicy: lifecycleOptions.secretMountPolicy,
        secretActorUserId: lifecycleOptions.secretActorUserId,
      }))
    execContext.copilotInteractionMode =
      lifecycleOptions.interactive === true ? 'interactive' : 'headless'
    if (goRoute && MOTHERSHIP_CODE_TOOL_ROUTES.has(goRoute)) {
      execContext.sandboxProfile = 'mothership'
    } else {
      execContext.sandboxProfile = undefined
    }
    if (isHosted && (!execContext.workspaceId || !execContext.billingAttribution)) {
      throw new Error('Billing attribution is required for hosted Copilot execution')
    }
    let hostedBillingRequest: AttributedBillingRequestEnvelope | undefined
    if (execContext.billingAttribution) {
      const billingAttribution = assertBillingAttributionSnapshot(execContext.billingAttribution)
      if (
        billingAttribution.actorUserId !== execContext.userId ||
        billingAttribution.workspaceId !== execContext.workspaceId
      ) {
        throw new Error('Copilot billing attribution does not match its actor and workspace')
      }
      execContext.billingAttribution = billingAttribution
      if (isHosted) {
        hostedBillingRequest = createAttributedBillingRequestEnvelope(billingAttribution)
      }
    }

    const context = createStreamingContext({
      chatId,
      requestId: lifecycleOptions.simRequestId,
      executionId: resolvedExecutionId,
      runId: resolvedRunId,
      messageId: payloadMsgId,
      toolPermissions: await resolveToolPermissions(lifecycleOptions),
      ...(lifecycleOptions.trace ? { trace: lifecycleOptions.trace } : {}),
    })
    let onCompleteStarted = false

    try {
      // Hosted admission (usage limits) belongs HERE, at dispatch, with the attribution
      // already in hand. The old path outsourced it to the Go backend's api-keys/validate
      // callback — a call the TS worker rightly never makes, so without this gate the
      // limit check simply never runs on the new path. On exceeded, the same synthetic
      // 402 UX as the mid-stream path renders the upgrade prompt, the backend is never
      // dispatched, and the shared verdict assembly below runs exactly as after a
      // mid-stream billing break.
      const admission =
        isHosted && execContext.billingAttribution
          ? await checkAttributedUsageLimits(
              assertBillingAttributionSnapshot(execContext.billingAttribution)
            )
          : { isExceeded: false as const }
      if (admission.isExceeded) {
        await handleBillingLimitResponse(execContext.userId, context, execContext, lifecycleOptions)
      } else {
        await ensureModelEgressRegistry(execContext, lifecycleOptions)
        const modelSafeRequestPayload = await omitUnsafeInitialCopilotAttachments(
          requestPayload,
          lifecycleOptions.workspaceId
        )
        await runCheckpointLoop(
          modelSafeRequestPayload,
          context,
          execContext,
          lifecycleOptions,
          goRoute,
          hostedBillingRequest
        )
      }

      // The backend's terminal `complete` is the turn's verdict. A failure it
      // reported in-band on the way there — a tool or a subagent that failed and
      // was handed back to the model as data — belongs to a turn that still
      // finished, so it must not turn the whole request into an error and discard
      // the work the user watched succeed.
      const backendFinishedTurn =
        context.completionStatus === MothershipStreamV1CompletionStatus.complete
      // Consult the lifecycle signal as well as the flag. `context.wasAborted` is
      // only reached from a fanout leg through the (deliberately asymmetric) merge
      // in `mergeResumeLegOutputs`, so a Stop landing mid-fanout could otherwise
      // classify the turn as a success. Mirrors the check already used below on
      // the throw path.
      const turnWasAborted = context.wasAborted || (lifecycleOptions.abortSignal?.aborted ?? false)
      const succeeded = !turnWasAborted && (backendFinishedTurn || context.errors.length === 0)

      const result: OrchestratorResult = {
        success: succeeded,
        // `cancelled` is an explicit discriminator so callers can tell
        // "user hit Stop" (persist partial assistant content through the
        // cancelled completion path) from "backend errored" (do clear the
        // row so the chat isn't stuck with a non-null `conversationId`).
        // An error that also
        // happens to fire the abort signal still counts as an error
        // path, but practically that doesn't happen in the success
        // branch here — if there are errors we never reach a
        // wasAborted-without-errors state.
        cancelled: turnWasAborted && context.errors.length === 0,
        content: resultContent(context, lifecycleOptions),
        contentBlocks: context.contentBlocks,
        toolCalls: buildToolCallSummaries(context),
        chatId: context.chatId,
        requestId: context.requestId,
        errors: !succeeded && context.errors.length ? context.errors : undefined,
        usage: context.usage,
        cost: context.cost,
      }
      if (lifecycleOptions.onComplete) {
        onCompleteStarted = true
        await lifecycleOptions.onComplete(result)
      }
      terminalResult = result
      return result
    } catch (error) {
      const err = toError(error)
      // A CopilotBackendError carries the upstream HTTP status + body (e.g. a 5xx
      // from /api/tools/resume when an oversized tool result — a rendered-doc
      // image — is posted back). Log those so a client-side "Stream error" that
      // originates from a thrown backend leg (vs an `error` SSE event) is
      // explained, not just reduced to a message string.
      logger.error('Copilot orchestration failed', {
        error: err.message,
        name: err.name,
        ...(error instanceof CopilotBackendError
          ? { backendStatus: error.status, backendBody: error.body?.slice(0, 2000) }
          : {}),
      })
      // If the abort signal fired, this throw is a consequence of the
      // cancel (publisher.publish fails once the client disconnects, a
      // downstream Go read throws on ctx cancel, etc.) — NOT a real
      // backend error. Don't invoke `onError`, because on the cancel
      // path `onComplete(cancelled)` persists partial content with an
      // idempotent row-locked finalizer. `onError` would race with it via
      // `finalizeAssistantTurn`, clearing `conversationId` before the
      // partial content can be appended.
      // Return `cancelled: true` so upstream classification stays
      // consistent with the success-path cancel result.
      const wasCancelled = lifecycleOptions.abortSignal?.aborted ?? false
      // Preserve whatever streamed before the throw for both terminals. A thrown
      // backend error (as opposed to an `error` SSE event that lets the loop finish
      // normally) must still carry the partial assistant turn so onError can
      // persist it — otherwise the post-error refetch replaces the rich live turn
      // with an empty assistant row and the UI appears to wipe the message +
      // subagent work.
      const result: OrchestratorResult = {
        success: false,
        cancelled: wasCancelled,
        content: context.accumulatedContent,
        contentBlocks: context.contentBlocks,
        toolCalls: buildToolCallSummaries(context),
        chatId: context.chatId,
        requestId: context.requestId,
        error: err.message,
        errors: context.errors.length ? context.errors : undefined,
        usage: context.usage,
        cost: context.cost,
      }

      if (!wasCancelled) {
        await lifecycleOptions.onError?.(err, result)
      } else if (!onCompleteStarted && lifecycleOptions.onComplete) {
        try {
          await lifecycleOptions.onComplete(result)
        } catch (completeError) {
          logger.error('Cancelled copilot completion callback failed', {
            error: toError(completeError).message,
          })
        }
      }
      terminalResult = result
      return result
    }
  } finally {
    /** Headless admission owns its record; the streaming adapter owns records it supplies. */
    if (ownedRunId) {
      const status = terminalResult?.success
        ? 'complete'
        : terminalResult?.cancelled || options.abortSignal?.aborted
          ? 'cancelled'
          : 'error'
      try {
        await updateRunStatus(ownedRunId, status, { completedAt: new Date() })
      } catch (error) {
        logger.warn('Headless run completion could not be persisted', {
          runId: ownedRunId,
          error: toError(error).message,
        })
      }
    }
  }
}

// Per-subagent checkpoint resume (concurrent fan-out)
//
// Under the per-subagent checkpoint model each paused subagent is its OWN
// checkpoint chain (frame.checkpointId) joined at the orchestrator. Instead of
// one bundled /resume, Sim drives one resume chain per child CONCURRENTLY so a
// fast child never waits on a slow sibling, and the Go join wakes the
// orchestrator on whichever child finishes last. Gated by the Go
// `parallel-subagents` flag, surfaced here purely by frames carrying their own
// checkpointId.
//
// IMPORTANT (concurrency): JS is single-threaded, so the legs interleave at await
// points rather than running truly in parallel; shared accumulators
// (contentBlocks, toolCalls maps, errors) are appended via atomic synchronous
// ops and stay shared by reference. Only the per-leg STREAM CONTROL flags
// (streamComplete, awaitingAsyncContinuation) and the join-leg scalars
// (accumulatedContent/usage/cost) are isolated per leg and merged back.

type AsyncContinuation = ResumeContinuation

function isPerSubagentContinuation(c: AsyncContinuation): boolean {
  return !!c.frames && c.frames.length > 0 && c.frames.every((f) => !!f.checkpointId)
}

// Shared header set for every Sim -> Go mothership request (initial stream and
// every resume leg), so the auth/source/version headers can't drift between the
// sequential path and the concurrent per-subagent resume legs.
// makeResumeLegContext / mergeResumeLegOutputs are a PAIR and must stay in
// lockstep: every field reset here is folded back there, and nothing else on
// StreamingContext is per-leg. Everything not listed is shared BY REFERENCE
// across all concurrent legs (the one merged chat: contentBlocks, toolCalls,
// pendingToolPromises, subagent maps, etc.). The per-leg ISOLATED set:
//   - streamComplete / awaitingAsyncContinuation: stream-control flags, so a
//     finished leg can't stop a sibling's read loop (reset only; not merged).
//   - accumulatedContent / finalAssistantContent / usage / cost: join-leg
//     scalars — only the join-carrying leg sets them; zeroing per leg keeps the
//     `+=` merge from multiplying the orchestrator's pre-fanout content by the
//     leg count, and keeps a child leg's stale usage/cost from clobbering the
//     join leg's real totals on merge.
//   - errors: a leg's transient retryable error (rolled back inside
//     runResumeLegWithRetry) must not truncate a concurrent sibling's shared
//     error array by index; each leg collects its own and merges the survivors.
//   - completionStatus: the backend's terminal verdict, set only on the leg that
//     carries the turn to its end; a stale one from a sibling would speak for a
//     turn that leg never finished.
//   - wasAborted: the ONE field with an asymmetric fold. Cancelling a fanout
//     cancels its siblings by design, and each cancelled sibling returns
//     normally with wasAborted set — folding that unconditionally marked the
//     SHARED context aborted, so every later leg was born aborted and every tool
//     it dispatched was cancelled before dispatch. Reset per leg, and fold back
//     only for a turn-level abort (see mergeResumeLegOutputs).
// When adding a per-leg field, update BOTH functions (and the contract test in
// resume-leg-context.test.ts). Exported only for that test.
export function makeResumeLegContext(base: StreamingContext): StreamingContext {
  return {
    ...base,
    streamComplete: false,
    awaitingAsyncContinuation: undefined,
    accumulatedContent: '',
    finalAssistantContent: '',
    usage: undefined,
    cost: undefined,
    errors: [],
    completionStatus: undefined,
    wasAborted: false,
  }
}

// mergeResumeLegOutputs folds a finished leg's isolated scalars back into the
// shared context. Child (subagent-lane) legs leave the join scalars empty; only
// the join-carrying leg (which streams the orchestrator continuation) sets them.
//
// `turnWasAborted` is the caller's answer to "was this abort the turn's, or just
// this fanout cancelling its own lanes?". Only a turn-level abort belongs on the
// shared context: it is what `runCopilotLifecycle` reads to classify the request
// as cancelled, and on the headless path (which never wires `onAbortObserved`)
// it is the only record that the abort marker was ever observed.
export function mergeResumeLegOutputs(
  context: StreamingContext,
  leg: StreamingContext,
  turnWasAborted = true
): void {
  if (leg.accumulatedContent) context.accumulatedContent += leg.accumulatedContent
  if (leg.finalAssistantContent) context.finalAssistantContent += leg.finalAssistantContent
  if (leg.usage) context.usage = leg.usage
  if (leg.cost) context.cost = leg.cost
  if (leg.sawMainToolCall) context.sawMainToolCall = true
  if (leg.wasAborted && turnWasAborted) context.wasAborted = true
  if (leg.errors.length > 0) context.errors.push(...leg.errors)
  if (leg.completionStatus) context.completionStatus = leg.completionStatus
}

async function waitForToolIds(
  context: StreamingContext,
  toolIds: string[],
  abortSignal?: AbortSignal
): Promise<boolean> {
  const promises: Promise<unknown>[] = []
  for (const id of toolIds) {
    const p = context.pendingToolPromises.get(id)
    if (p) promises.push(p)
  }
  if (promises.length === 0) return true
  if (!abortSignal) {
    await Promise.allSettled(promises)
    return true
  }
  if (abortSignal.aborted) return false

  let onAbort = () => {}
  const aborted = new Promise<false>((resolve) => {
    onAbort = () => resolve(false)
    abortSignal.addEventListener('abort', onAbort, { once: true })
    if (abortSignal.aborted) onAbort()
  })
  try {
    return await Promise.race([Promise.allSettled(promises).then(() => true as const), aborted])
  } finally {
    abortSignal.removeEventListener('abort', onAbort)
  }
}

interface ResumeToolResult {
  callId: string
  name: string
  data: unknown
  success: boolean
}

/** Missing observation cannot become a tool failure while another controller owns execution. */
function buildResumeToolResult(
  context: StreamingContext,
  toolCallId: string,
  checkpointId: string | undefined
): ResumeToolResult {
  const tool = context.toolCalls.get(toolCallId)
  if (!tool || !tool.result) {
    recordDegraded(CopilotDegradedReason.MissingToolResult)
    logger.error('Cannot resume without a confirmed tool result', {
      toolCallId,
      checkpointId,
      hasToolEntry: !!tool,
      toolName: tool?.name,
      toolStatus: tool?.status,
      hasPendingPromise: context.pendingToolPromises.has(toolCallId),
    })
    throw new Error(
      `No confirmed result is available for tool call ${toolCallId}; its execution may still be running`
    )
  }
  return {
    callId: toolCallId,
    name: tool.name || '',
    data: getToolCallTerminalData(tool),
    success: requireToolCallStateResult(tool).success,
  }
}

function collectResultsForToolIds(
  context: StreamingContext,
  toolIds: string[],
  checkpointId: string
): ResumeToolResult[] {
  return toolIds.map((toolCallId) => buildResumeToolResult(context, toolCallId, checkpointId))
}

/**
 * A child connection has the same recovery budget as a main connection. Failed
 * attempts roll back only this lane's errors, preserving concurrent sibling work.
 * Stop and sibling cancellation interrupt recovery before another request starts.
 */
async function runResumeLegWithRetry(
  url: string,
  body: Record<string, unknown>,
  leg: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<void> {
  const retry = new StreamRetryWindow(options.timeout)
  for (;;) {
    options.abortSignal?.throwIfAborted()
    const errorsBeforeAttempt = leg.errors.length
    try {
      await runStreamLoop(
        url,
        {
          method: 'POST',
          headers: mothershipRequestHeaders(hostedBillingRequest, options.simRequestId),
          body: JSON.stringify(body),
        },
        leg,
        execContext,
        { ...options, timeout: retry.remainingMs() }
      )
      return
    } catch (error) {
      const backoff = retry.nextDelay(error, options.abortSignal)
      if (backoff !== null) {
        leg.errors.length = errorsBeforeAttempt
        logger.warn('Child resume leg failed, retrying', {
          attempt: retry.attempt + 1,
          backoffMs: backoff,
          error: toError(error).message,
        })
        await interruptibleSleep(backoff, options.abortSignal)
        continue
      }
      throw error
    }
  }
}

// driveOneChildChain resumes a single subagent's checkpoint chain to its end:
// resume -> (re-pause -> resume)* -> fold into join. Returns the orchestrator's
// follow-on continuation when THIS leg is the one the Go join woke (the last
// finisher whose /resume response carried the orchestrator continuation), else
// null. Re-pause vs follow-on is disambiguated by checkpoint id: a re-pause keeps
// the same child id; the join continuation is a different (orchestrator) id.
async function driveOneChildChain(
  frame: ResumeFrame,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  baseURL: string,
  /**
   * The turn's own abort signal, NOT the fanout controller in `options`. Used to
   * tell "the user stopped the turn" from "a lane failed and cancelled its
   * siblings" when deciding whether a leg's abort belongs on the shared context.
   */
  turnAbortSignal: AbortSignal | undefined,
  workspaceId?: string,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<AsyncContinuation | null> {
  // ParentToolCallID is the SAME subagent's stable identity across re-pauses;
  // the checkpoint id rotates each re-pause (the prior one is already claimed).
  const parentToolCallId = frame.parentToolCallId
  // Guarded (not cast): a per-subagent frame always carries its own checkpointId
  // (isPerSubagentContinuation requires it), but a local guard keeps this driver
  // correct on its own terms rather than trusting a caller-side invariant.
  if (!frame.checkpointId) return null
  let checkpointId = frame.checkpointId
  let toolIds = frame.pendingToolIds

  for (;;) {
    if (isAborted(options, context)) return null

    const toolsSettled = await waitForToolIds(context, toolIds, options.abortSignal)
    if (!toolsSettled || isAborted(options, context)) return null
    const results = collectResultsForToolIds(context, toolIds, checkpointId)

    const leg = makeResumeLegContext(context)
    // The abort marker is turn-scoped (keyed on the shared messageId), so a leg
    // that observes it at body close IS a turn-level abort — and on the headless
    // path, where `onAbortObserved` is never wired to the turn controller, this
    // is the only record of it.
    let markerObserved = false
    const legOptions: CopilotLifecycleOptions = {
      ...options,
      onAbortObserved: (reason) => {
        if (reason === AbortReason.MarkerObservedAtBodyClose) markerObserved = true
        options.onAbortObserved?.(reason)
      },
    }
    // Same per-leg BYOK rule as the main loop: this child-chain resume can also land on
    // a dead run and become a hosted-key continuation without it.
    const byokApiKey = await resolveEnterpriseByokKey(workspaceId)
    await runResumeLegWithRetry(
      `${baseURL}/api/tools/resume`,
      {
        streamId: context.messageId,
        results,
        ...(byokApiKey ? { byokApiKey } : {}),
      },
      leg,
      execContext,
      legOptions,
      hostedBillingRequest
    )
    mergeResumeLegOutputs(context, leg, markerObserved || (turnAbortSignal?.aborted ?? false))

    const cont = leg.awaitingAsyncContinuation
    if (!cont) {
      // The last finisher's leg, whose join continuation streamed the
      // orchestrator to completion (done): nothing more to drive on this leg.
      return null
    }
    // A NON-last finisher folds with a TERMINAL pause carrying the join id but
    // NO pending tools and NO frames — the child's work is done and the join
    // wakes on whichever sibling finishes last. End this leg cleanly; do NOT
    // mistake the join id for an orchestrator follow-on and try to resume it.
    const hasPending = (cont.pendingToolCallIds?.length ?? 0) > 0
    const hasFrames = (cont.frames?.length ?? 0) > 0
    if (!hasPending && !hasFrames) {
      return null
    }
    // Re-pause is identified by THIS subagent's stable parentToolCallId (the
    // checkpoint id rotates each re-pause). If present, keep driving this child
    // with its new id + leaves.
    const repaused = cont.frames?.find(
      (f) => f.parentToolCallId === parentToolCallId && f.checkpointId
    )
    if (repaused?.checkpointId) {
      checkpointId = repaused.checkpointId
      toolIds = repaused.pendingToolIds
      continue
    }
    // No frame for this subagent => the join fired and the orchestrator re-paused
    // on this leg. Hand it back to the main loop to continue the turn.
    return cont
  }
}

// driveSubagentChains fans out one resume chain per child frame concurrently and
// returns the single orchestrator follow-on continuation (if the orchestrator
// re-paused after the join), or null when the turn completed.
//
// Failure isolation: the legs share a per-fanout AbortController so the FIRST leg
// to fail cancels its siblings' in-flight resumes (otherwise a `Promise.all`
// reject leaves the siblings running detached — still mutating shared context and
// POSTing /resume after the turn has errored). The controller also chains off the
// caller's abort signal so a user stop cancels every leg. Each leg's failure is
// caught (so Promise.all can't reject before its siblings unwind); we then
// rethrow the first REAL error, not the AbortErrors it triggered in the siblings.
async function driveSubagentChains(
  continuation: AsyncContinuation,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  baseURL: string,
  workspaceId?: string,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<AsyncContinuation | null> {
  const frames = continuation.frames ?? []
  logger.info('Driving subagent checkpoint chains concurrently', {
    childCount: frames.length,
    checkpointIds: frames.map((f) => f.checkpointId),
  })

  const fanoutController = new AbortController()
  const parentSignal = options.abortSignal
  const onParentAbort = () => fanoutController.abort()
  if (parentSignal) {
    if (parentSignal.aborted) fanoutController.abort()
    else parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }
  const legOptions: CopilotLifecycleOptions = { ...options, abortSignal: fanoutController.signal }

  let firstError: unknown
  try {
    const followOns = await Promise.all(
      frames.map((frame) =>
        driveOneChildChain(
          frame,
          context,
          execContext,
          legOptions,
          baseURL,
          parentSignal,
          workspaceId,
          hostedBillingRequest
        ).catch((error) => {
          // First real failure wins and cancels the siblings; their resulting
          // AbortErrors arrive later and don't overwrite it. Swallow here so
          // Promise.all doesn't reject before every leg has unwound.
          if (firstError === undefined) firstError = error
          fanoutController.abort()
          return null
        })
      )
    )
    if (firstError !== undefined) throw firstError
    return followOns.find((c): c is AsyncContinuation => !!c) ?? null
  } finally {
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

// Checkpoint loop – the core state machine

async function runCheckpointLoop(
  initialPayload: Record<string, unknown>,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  initialRoute: string,
  hostedBillingRequest?: AttributedBillingRequestEnvelope
): Promise<void> {
  let route = initialRoute
  let payload: Record<string, unknown> = initialPayload
  let retry: StreamRetryWindow | undefined
  const callerOnEvent = options.onEvent
  const mothershipBaseURL = await getMothershipBaseURL({ userId: options.userId })
  const lifecycleWorkspaceId = nonBlankString(options.workspaceId)
  const mothershipRequestId = nonBlankString(options.simRequestId) ?? generateId()
  if (!options.simRequestId) {
    options = { ...options, simRequestId: mothershipRequestId }
  }
  const systemPromptOverride = env.MSHIP_SYSPROMPT_OVERRIDE

  if (typeof systemPromptOverride === 'string' && systemPromptOverride.trim() !== '') {
    payload = { ...payload, systemPromptOverride }
  }

  // Go's auth middleware re-validates every Sim -> Go request by reading
  // workspaceId from the JSON body and forwarding it to Sim's validate route,
  // where it is required for the per-member usage gate. Normalize the initial
  // leg from the lifecycle option so callers that only set the option (not the
  // raw payload) still send it on the first request.
  if (lifecycleWorkspaceId && !nonBlankString(payload.workspaceId)) {
    payload = { ...payload, workspaceId: lifecycleWorkspaceId }
  }

  for (;;) {
    context.streamComplete = false
    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }
    const isResume = route === '/api/tools/resume'

    // Enterprise BYOK rides EVERY leg, resume included: a resume that lands on a dead
    // run becomes a continuation with no closure holding the key. Re-resolved per leg so
    // revocation is immediate (key rows are read fresh; entitlement is cached).
    payload = await withEnterpriseByokKey(payload, route, lifecycleWorkspaceId)

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const loopOptions = {
      ...options,
      /* The wrapper below always exists (checkpoint bookkeeping), so the forwarder can't
         infer "headless" from onEvent's absence — declare it: only a caller-attached sink
         has an HTTP buffer worth a per-event macrotask flush. */
      flushAfterEvent: options.flushAfterEvent ?? Boolean(callerOnEvent),
      onEvent: async (event: StreamEvent) => {
        if (
          event.type === MothershipStreamV1EventType.run &&
          event.payload.kind === MothershipStreamV1RunKind.checkpoint_pause &&
          options.runId
        ) {
          try {
            await updateRunStatus(options.runId, 'paused_waiting_for_tool')
          } catch (error) {
            logger.warn('Failed to mark run as paused_waiting_for_tool', {
              runId: options.runId,
              error: toError(error).message,
            })
          }
        }
        await callerOnEvent?.(event)
      },
    }

    retry ??= new StreamRetryWindow(options.timeout)
    const streamSpan = context.trace.startSpan(
      isResume ? 'Sim → Go (Resume)' : 'Sim → Go Stream',
      isResume ? 'lifecycle.resume' : 'sim.stream',
      {
        route,
        isResume,
        ...(isResume ? { attempt: retry.attempt } : {}),
      }
    )
    context.trace.setActiveSpan(streamSpan)

    logger.info('Starting stream loop', {
      route,
      isResume,
      resumeAttempt: retry.attempt,
      pendingToolPromises: context.pendingToolPromises.size,
      toolCallCount: context.toolCalls.size,
      hasCheckpoint: !!context.awaitingAsyncContinuation,
    })

    // Snapshot recorded errors before this attempt. If the attempt fails with
    // a retryable resume error, we roll back to this baseline before retrying
    // so a subsequent successful retry doesn't inherit the failed attempt's
    // errors (e.g. the 5xx the backend refused the leg with) and get
    // mis-finalized as `error`.
    const errorsBeforeAttempt = context.errors.length

    try {
      await runStreamLoop(
        `${mothershipBaseURL}${route}`,
        {
          method: 'POST',
          headers: mothershipRequestHeaders(hostedBillingRequest, mothershipRequestId),
          body: JSON.stringify({
            ...payload,
            ...(route === '/api/mothership' ||
            route === '/api/copilot' ||
            route === '/api/mothership/execute' ||
            isResume
              ? ({
                  receivedTextChars: context.accumulatedContent.length,
                  receivedActivity: context.receivedActivity,
                } satisfies StreamResponseReceipt)
              : {}),
          }),
        },
        context,
        execContext,
        { ...loopOptions, timeout: retry.remainingMs() }
      )
      const streamStatus = isAborted(options, context)
        ? RequestTraceV1SpanStatus.cancelled
        : context.errors.length > 0
          ? RequestTraceV1SpanStatus.error
          : RequestTraceV1SpanStatus.ok
      context.trace.endSpan(streamSpan, streamStatus)
      context.trace.setActiveSpan(undefined)
      retry = undefined
    } catch (streamError) {
      context.trace.endSpan(streamSpan, RequestTraceV1SpanStatus.error)
      context.trace.setActiveSpan(undefined)
      if (streamError instanceof BillingLimitError) {
        await handleBillingLimitResponse(streamError.userId, context, execContext, options)
        break
      }
      const backoff = retry?.nextDelay(streamError, options.abortSignal) ?? null
      if (backoff !== null) {
        /** A recovered connection must not finalize with an earlier transport failure. */
        context.errors.length = errorsBeforeAttempt
        logger.warn(
          isResume ? 'Resume stream failed, retrying' : 'Initial stream failed, retrying',
          {
            attempt: (retry?.attempt ?? 0) + 1,
            backoffMs: backoff,
            error: toError(streamError).message,
          }
        )
        await interruptibleSleep(backoff, options.abortSignal)
        continue
      }
      throw streamError
    }

    logger.info('Stream loop completed', {
      route,
      isResume,
      isAborted: isAborted(options, context),
      hasCheckpoint: !!context.awaitingAsyncContinuation,
      checkpointId: context.awaitingAsyncContinuation?.checkpointId,
      pendingToolPromises: context.pendingToolPromises.size,
      streamComplete: context.streamComplete,
      toolCallCount: context.toolCalls.size,
    })

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    let continuation = context.awaitingAsyncContinuation
    if (!continuation) break

    // Per-subagent checkpoint model: fan out one concurrent resume chain per
    // child instead of a single bundled resume. The driver returns null when the
    // turn completed, or the orchestrator's follow-on continuation when it
    // re-paused after the join. A per-subagent follow-on (orchestrator spawned
    // more subagents) loops back through the driver; a normal follow-on falls
    // through to the sequential resume path below.
    if (isPerSubagentContinuation(continuation)) {
      context.awaitingAsyncContinuation = undefined
      let next: AsyncContinuation | null = continuation
      while (next && isPerSubagentContinuation(next)) {
        if (isAborted(options, context)) {
          cancelPendingTools(context)
          next = null
          break
        }
        const toolsSettled = await waitForToolIds(
          context,
          next.pendingToolCallIds,
          options.abortSignal
        )
        if (!toolsSettled || isAborted(options, context)) {
          next = null
          break
        }
        next = await driveSubagentChains(
          next,
          context,
          execContext,
          options,
          mothershipBaseURL,
          lifecycleWorkspaceId,
          hostedBillingRequest
        )
      }
      if (!next) {
        if (isAborted(options, context)) cancelPendingTools(context)
        break
      }
      continuation = next
    }

    if (context.pendingToolPromises.size > 0) {
      const waitSpan = context.trace.startSpan('Wait for Tools', 'lifecycle.wait_tools', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
      })
      let maximumWaitBudgetMs = 0
      let timedOutCount = 0
      const pendingWatchdogs = new Map<
        string,
        {
          promise: Promise<AsyncCompletionSignal>
          settlement: Promise<{
            toolCallId: string
            promise: Promise<AsyncCompletionSignal>
          }>
          deadlineAt: number
          waitBudgetMs: number
        }
      >()

      /**
       * A long-running approval must not lend its deadline to an unrelated
       * short tool. Wake for the earliest promise settlement or deadline so a
       * replaced call can receive its own watchdog without waiting for a long
       * sibling. Unchanged promises retain their absolute deadlines.
       */
      while (context.pendingToolPromises.size > 0) {
        if (isAborted(options, context)) break
        const now = Date.now()
        for (const [toolCallId, watchdog] of pendingWatchdogs) {
          if (context.pendingToolPromises.get(toolCallId) !== watchdog.promise) {
            pendingWatchdogs.delete(toolCallId)
          }
        }
        for (const [toolCallId, promise] of context.pendingToolPromises) {
          if (pendingWatchdogs.get(toolCallId)?.promise === promise) continue
          const waitBudgetMs =
            pendingToolWaitBudgetMs(context.toolCalls.get(toolCallId)) +
            TOOL_WATCHDOG_RESUME_GRACE_MS
          pendingWatchdogs.set(toolCallId, {
            promise,
            settlement: promise.then(
              () => ({ toolCallId, promise }),
              () => ({ toolCallId, promise })
            ),
            deadlineAt: now + waitBudgetMs,
            waitBudgetMs,
          })
          maximumWaitBudgetMs = Math.max(maximumWaitBudgetMs, waitBudgetMs)
        }

        const expiredTools = Array.from(pendingWatchdogs.entries()).filter(
          ([toolCallId, watchdog]) =>
            watchdog.deadlineAt <= now &&
            context.pendingToolPromises.get(toolCallId) === watchdog.promise
        )
        if (expiredTools.length > 0) {
          await Promise.all(
            expiredTools.map(async ([toolCallId, watchdog]) => {
              logger.error(
                'Pending tool execution exceeded its resume wait budget; force-failing',
                {
                  checkpointId: continuation.checkpointId,
                  toolCallId,
                  waitBudgetMs: watchdog.waitBudgetMs,
                }
              )
              await failPendingToolCall(
                toolCallId,
                context,
                'Tool execution hung on the Sim executor and was abandoned so the conversation could continue.'
              )
              if (context.pendingToolPromises.get(toolCallId) === watchdog.promise) {
                context.pendingToolPromises.delete(toolCallId)
              }
              pendingWatchdogs.delete(toolCallId)
            })
          )
          timedOutCount += expiredTools.length
          continue
        }

        const activeWatchdogs = Array.from(pendingWatchdogs.entries())
        // Every pending promise re-adds its watchdog above, so this cannot be empty; a
        // bare `continue` here would busy-spin the event loop if that ever broke.
        if (activeWatchdogs.length === 0) break
        const nextDeadlineAt = Math.min(
          ...activeWatchdogs.map(([, watchdog]) => watchdog.deadlineAt)
        )
        logger.info('Waiting for in-flight tool executions before resume', {
          checkpointId: continuation.checkpointId,
          pendingCount: activeWatchdogs.length,
          maximumWaitBudgetMs,
          nextDeadlineAt,
        })

        const watchdogController = new AbortController()
        const waitSignal = options.abortSignal
          ? AbortSignal.any([watchdogController.signal, options.abortSignal])
          : watchdogController.signal
        try {
          const wake = await Promise.race([
            ...activeWatchdogs.map(([, watchdog]) => watchdog.settlement),
            interruptibleSleep(Math.max(0, nextDeadlineAt - Date.now()), waitSignal).then(
              () => null
            ),
          ])
          if (isAborted(options, context)) break
          if (wake && context.pendingToolPromises.get(wake.toolCallId) === wake.promise) {
            context.pendingToolPromises.delete(wake.toolCallId)
          }
        } finally {
          watchdogController.abort()
        }
      }
      const waitWasAborted = isAborted(options, context)
      waitSpan.attributes = {
        ...waitSpan.attributes,
        waitBudgetMs: maximumWaitBudgetMs,
        timedOutCount,
        aborted: waitWasAborted,
        settledInTime: timedOutCount === 0 && !waitWasAborted,
      }
      context.trace.endSpan(
        waitSpan,
        waitWasAborted ? RequestTraceV1SpanStatus.cancelled : RequestTraceV1SpanStatus.ok
      )
    }

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const undispatchedToolIds = continuation.pendingToolCallIds.filter((toolCallId) => {
      const tool = context.toolCalls.get(toolCallId)
      return (
        !!tool &&
        !tool.result &&
        !tool.error &&
        !context.pendingToolPromises.has(toolCallId) &&
        tool.status !== 'executing'
      )
    })

    if (undispatchedToolIds.length > 0) {
      logger.warn('Checkpointed tools were never dispatched; executing before resume', {
        checkpointId: continuation.checkpointId,
        toolCallIds: undispatchedToolIds,
      })
      await Promise.allSettled(
        undispatchedToolIds.map((toolCallId) =>
          executeToolAndReport(toolCallId, context, execContext, options)
        )
      )
    }

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const results: ResumeToolResult[] = []
    for (const toolCallId of continuation.pendingToolCallIds) {
      if (isAborted(options, context)) {
        cancelPendingTools(context)
        context.awaitingAsyncContinuation = undefined
        break
      }
      results.push(buildResumeToolResult(context, toolCallId, continuation.checkpointId))
    }

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    logger.info('Resuming with tool results', {
      checkpointId: continuation.checkpointId,
      runId: continuation.runId,
      toolCount: results.length,
      pendingToolCallIds: continuation.pendingToolCallIds,
      frameCount: continuation.frames?.length ?? 0,
    })

    context.awaitingAsyncContinuation = undefined
    route = '/api/tools/resume'
    payload = {
      streamId: context.messageId,
      results,
    }

    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    logger.info('Prepared resume request payload', {
      route,
      streamId: context.messageId,
      checkpointId: continuation.checkpointId,
      resultCount: results.length,
    })
  }
}

// Execution context builder

async function buildExecutionContext(
  requestPayload: Record<string, unknown>,
  params: {
    userId: string
    workflowId?: string
    workspaceId?: string
    chatId?: string
    executionId?: string
    runId?: string
    abortSignal?: AbortSignal
    billingAttribution?: BillingAttributionSnapshot
    resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    environmentContext?: CopilotEnvironmentContext
    userPermission?: PermissionType
    secretMountPolicy?: SecretMountPolicy
    secretActorUserId?: string | null
  }
): Promise<ExecutionContext> {
  const {
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    abortSignal,
    billingAttribution,
    resolvedSecretTraceRegistry,
    environmentContext,
    userPermission,
    secretMountPolicy,
    secretActorUserId,
  } = params
  const userTimezone =
    typeof requestPayload?.userTimezone === 'string' ? requestPayload.userTimezone : undefined
  const requestMode = typeof requestPayload?.mode === 'string' ? requestPayload.mode : undefined

  let execContext: ExecutionContext
  if (workflowId) {
    execContext = await prepareExecutionContext(userId, workflowId, chatId, {
      workspaceId,
      billingAttribution,
      environmentContext,
    })
  } else {
    const activeEnvironmentContext =
      environmentContext ?? (await prepareCopilotEnvironmentContext(userId, workspaceId))
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      chatId,
      ...activeEnvironmentContext,
      billingAttribution,
    }
  }

  if (userTimezone) execContext.userTimezone = userTimezone
  execContext.copilotToolExecution = true
  if (requestMode) execContext.requestMode = requestMode
  if (userPermission) execContext.userPermission = userPermission
  execContext.messageId =
    typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : undefined
  execContext.executionId = executionId
  execContext.runId = runId
  execContext.abortSignal = abortSignal
  if (billingAttribution) execContext.billingAttribution = billingAttribution
  if (resolvedSecretTraceRegistry) {
    execContext.resolvedSecretTraceRegistry = resolvedSecretTraceRegistry
  }
  if (secretMountPolicy) execContext.secretMountPolicy = secretMountPolicy
  if (secretActorUserId !== undefined) execContext.secretActorUserId = secretActorUserId
  return execContext
}

async function ensureHeadlessRunIdentity(input: {
  requestPayload: Record<string, unknown>
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  messageId: string
}): Promise<{ executionId?: string; runId?: string; cancelled?: boolean }> {
  if (!input.chatId || input.executionId || input.runId) {
    return {
      executionId: input.executionId,
      runId: input.runId,
    }
  }

  const executionId = generateId()
  const runId = generateId()

  try {
    const run = await createRunSegment({
      id: runId,
      executionId,
      chatId: input.chatId,
      userId: input.userId,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      streamId: input.messageId,
      model: typeof input.requestPayload?.model === 'string' ? input.requestPayload.model : null,
      provider:
        typeof input.requestPayload?.provider === 'string' ? input.requestPayload.provider : null,
      requestContext: {
        source: 'headless_lifecycle',
      },
    })
    return { executionId, runId, cancelled: run.status === 'cancelled' }
  } catch {
    throw new Error('Chat could not start because its execution record is unavailable')
  }
}

// Helpers

/**
 * Routes whose payloads carry `byokApiKey` (see resolveEnterpriseByokKey): every
 * model-reaching worker call, INCLUDING tool-resume — a resume that lands on a dead run
 * becomes a continuation leg with no closure holding the key, so omitting it there
 * silently finishes an enterprise chat on the hosted key.
 */
const BYOK_ROUTES = [
  '/api/mothership',
  '/api/mothership/execute',
  '/api/copilot',
  '/api/tools/resume',
]

async function withEnterpriseByokKey(
  payload: Record<string, unknown>,
  route: string,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  if (!BYOK_ROUTES.includes(route)) return payload
  const byokApiKey = await resolveEnterpriseByokKey(workspaceId)
  return byokApiKey ? { ...payload, byokApiKey } : payload
}

function isAborted(options: CopilotLifecycleOptions, context: StreamingContext): boolean {
  return !!(options.abortSignal?.aborted || context.wasAborted)
}

function cancelPendingTools(context: StreamingContext): void {
  for (const [, toolCall] of context.toolCalls) {
    if (
      toolCall.status === 'pending' ||
      toolCall.status === 'executing' ||
      toolCall.status === 'awaiting_approval'
    ) {
      setTerminalToolCallState(toolCall, {
        status: MothershipStreamV1ToolOutcome.cancelled,
        error: 'Stopped by user',
      })
    }
  }
}
