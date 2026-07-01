import type { Context } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { createRunSegment, updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_VERSION, TOOL_WATCHDOG_RESUME_GRACE_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/copilot/request/context/result'
import {
  BillingLimitError,
  CopilotBackendError,
  runStreamLoop,
} from '@/lib/copilot/request/go/stream'
import {
  getToolCallTerminalData,
  requireToolCallStateResult,
  setTerminalToolCallState,
} from '@/lib/copilot/request/tool-call-state'
import { handleBillingLimitResponse } from '@/lib/copilot/request/tools/billing'
import {
  executeToolAndReport,
  forceFailHungToolCall,
  toolWatchdogTimeoutMs,
} from '@/lib/copilot/request/tools/executor'
import type { TraceCollector } from '@/lib/copilot/request/trace'
import { RequestTraceV1SpanStatus } from '@/lib/copilot/request/trace'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  ResumeContinuation,
  ResumeFrame,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { getMothershipBaseURL, getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'

const logger = createLogger('CopilotLifecycle')

const MAX_RESUME_ATTEMPTS = 3
const RESUME_BACKOFF_MS = [250, 500, 1000] as const

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
  const resolvedExecutionId = runIdentity.executionId ?? executionId
  const resolvedRunId = runIdentity.runId ?? runId
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
    }))

  // Only genuine interactive turns have a persisted `copilot_chats` row; headless
  // runs (e.g. Mothership block execution) carry an ephemeral, non-persisted
  // chatId. Server tools gate chat-scoped `outputs/` writes on this so they never
  // attempt a `chat_id` FK insert against a chat that does not exist.
  execContext.interactive = lifecycleOptions.interactive === true

  const context = createStreamingContext({
    chatId,
    requestId: lifecycleOptions.simRequestId,
    executionId: resolvedExecutionId,
    runId: resolvedRunId,
    messageId: payloadMsgId,
    ...(lifecycleOptions.trace ? { trace: lifecycleOptions.trace } : {}),
  })
  let onCompleteStarted = false

  try {
    await runCheckpointLoop(requestPayload, context, execContext, lifecycleOptions, goRoute)

    const result: OrchestratorResult = {
      success: context.errors.length === 0 && !context.wasAborted,
      // `cancelled` is an explicit discriminator so callers can tell
      // "user hit Stop" (persist partial assistant content through the
      // cancelled completion path) from "backend errored" (do clear the
      // row so the chat isn't stuck with a non-null `conversationId`).
      // An error that also
      // happens to fire the abort signal still counts as an error
      // path, but practically that doesn't happen in the success
      // branch here — if there are errors we never reach a
      // wasAborted-without-errors state.
      cancelled: context.wasAborted && context.errors.length === 0,
      content: resultContent(context, lifecycleOptions),
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      requestId: context.requestId,
      errors: context.errors.length ? context.errors : undefined,
      usage: context.usage,
      cost: context.cost,
    }
    if (lifecycleOptions.onComplete) {
      onCompleteStarted = true
      await lifecycleOptions.onComplete(result)
    }
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
    return result
  }
}

// ---------------------------------------------------------------------------
// Per-subagent checkpoint resume (concurrent fan-out)
// ---------------------------------------------------------------------------
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
function mothershipRequestHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    ...getMothershipSourceEnvHeaders(),
    'X-Client-Version': SIM_AGENT_VERSION,
  }
}

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
  }
}

// mergeResumeLegOutputs folds a finished leg's isolated scalars back into the
// shared context. Child (subagent-lane) legs leave the join scalars empty; only
// the join-carrying leg (which streams the orchestrator continuation) sets them.
export function mergeResumeLegOutputs(context: StreamingContext, leg: StreamingContext): void {
  if (leg.accumulatedContent) context.accumulatedContent += leg.accumulatedContent
  if (leg.finalAssistantContent) context.finalAssistantContent += leg.finalAssistantContent
  if (leg.usage) context.usage = leg.usage
  if (leg.cost) context.cost = leg.cost
  if (leg.sawMainToolCall) context.sawMainToolCall = true
  if (leg.wasAborted) context.wasAborted = true
  if (leg.errors.length > 0) context.errors.push(...leg.errors)
}

async function waitForToolIds(context: StreamingContext, toolIds: string[]): Promise<void> {
  const promises: Promise<unknown>[] = []
  for (const id of toolIds) {
    const p = context.pendingToolPromises.get(id)
    if (p) promises.push(p)
  }
  if (promises.length > 0) await Promise.allSettled(promises)
}

function collectResultsForToolIds(
  context: StreamingContext,
  toolIds: string[],
  checkpointId: string
): Array<{ callId: string; name: string; data: unknown; success: boolean }> {
  return toolIds.map((toolCallId) => {
    const tool = context.toolCalls.get(toolCallId)
    if (!tool || !tool.result) {
      throw new Error(
        `Cannot resume subagent chain ${checkpointId}: missing result for tool call ${toolCallId}`
      )
    }
    return {
      callId: toolCallId,
      name: tool.name || '',
      data: getToolCallTerminalData(tool),
      success: requireToolCallStateResult(tool).success,
    }
  })
}

// runResumeLegWithRetry runs ONE resume POST with the same retryable-error +
// bounded-backoff policy the sequential checkpoint loop uses, so a concurrent
// child leg survives a transient Go 5xx (or network blip) instead of failing the
// whole turn — Go releases the claim on such errors expecting a retry. The leg's
// transient error is rolled back on its OWN (isolated) errors array so a
// recovered retry isn't mis-finalized as `error`. An AbortError (a sibling
// failure cancelling this leg, see driveSubagentChains) is non-retryable and
// propagates immediately.
async function runResumeLegWithRetry(
  url: string,
  body: Record<string, unknown>,
  leg: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions
): Promise<void> {
  let attempt = 0
  for (;;) {
    const errorsBeforeAttempt = leg.errors.length
    const willRetryOnStreamError = attempt < MAX_RESUME_ATTEMPTS - 1
    const legBody = willRetryOnStreamError ? { ...body, willRetryOnStreamError: true } : body
    try {
      await runStreamLoop(
        url,
        { method: 'POST', headers: mothershipRequestHeaders(), body: JSON.stringify(legBody) },
        leg,
        execContext,
        options
      )
      return
    } catch (error) {
      if (isRetryableStreamError(error) && attempt < MAX_RESUME_ATTEMPTS - 1) {
        leg.errors.length = errorsBeforeAttempt
        attempt++
        const backoff = RESUME_BACKOFF_MS[attempt - 1] ?? 1000
        logger.warn('Child resume leg failed, retrying', {
          attempt: attempt + 1,
          maxAttempts: MAX_RESUME_ATTEMPTS,
          backoffMs: backoff,
          error: toError(error).message,
        })
        await sleepWithAbort(backoff, options.abortSignal)
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
  workspaceId?: string
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

    await waitForToolIds(context, toolIds)
    const results = collectResultsForToolIds(context, toolIds, checkpointId)

    const leg = makeResumeLegContext(context)
    await runResumeLegWithRetry(
      `${baseURL}/api/tools/resume`,
      {
        streamId: context.messageId,
        checkpointId,
        userId: options.userId,
        ...(workspaceId ? { workspaceId } : {}),
        results,
      },
      leg,
      execContext,
      options
    )
    mergeResumeLegOutputs(context, leg)

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
  workspaceId?: string
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
        driveOneChildChain(frame, context, execContext, legOptions, baseURL, workspaceId).catch(
          (error) => {
            // First real failure wins and cancels the siblings; their resulting
            // AbortErrors arrive later and don't overwrite it. Swallow here so
            // Promise.all doesn't reject before every leg has unwound.
            if (firstError === undefined) firstError = error
            fanoutController.abort()
            return null
          }
        )
      )
    )
    if (firstError !== undefined) throw firstError
    return followOns.find((c): c is AsyncContinuation => !!c) ?? null
  } finally {
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

// ---------------------------------------------------------------------------
// Checkpoint loop – the core state machine
// ---------------------------------------------------------------------------

async function runCheckpointLoop(
  initialPayload: Record<string, unknown>,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions,
  initialRoute: string
): Promise<void> {
  let route = initialRoute
  let payload: Record<string, unknown> = initialPayload
  let resumeAttempt = 0
  const callerOnEvent = options.onEvent
  const mothershipBaseURL = await getMothershipBaseURL({ userId: options.userId })
  const lifecycleWorkspaceId = nonBlankString(options.workspaceId)

  // Go's auth middleware re-validates every Sim -> Go request by reading
  // workspaceId from the JSON body and forwarding it to Sim's validate route,
  // where it is required for the per-member usage gate. Normalize the initial
  // leg from the lifecycle option so callers that only set the option (not the
  // raw payload) still send it on the first request.
  if (lifecycleWorkspaceId && !nonBlankString(payload.workspaceId)) {
    payload = { ...payload, workspaceId: lifecycleWorkspaceId }
  }

  // Enterprise BYOK eligibility hint: set once on the initial mothership request
  // so Go only attempts a BYOK lookup for entitled workspaces. This is only a
  // gate — Go re-confirms entitlement authoritatively before using any key.
  payload = await withByokEligibilityHint(payload, route, lifecycleWorkspaceId)

  for (;;) {
    context.streamComplete = false
    const isResume = route === '/api/tools/resume'

    if (isResume && isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }

    const loopOptions = {
      ...options,
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

    const streamSpan = context.trace.startSpan(
      isResume ? 'Sim → Go (Resume)' : 'Sim → Go Stream',
      isResume ? 'lifecycle.resume' : 'sim.stream',
      {
        route,
        isResume,
        ...(isResume ? { attempt: resumeAttempt } : {}),
      }
    )
    context.trace.setActiveSpan(streamSpan)

    logger.info('Starting stream loop', {
      route,
      isResume,
      resumeAttempt,
      pendingToolPromises: context.pendingToolPromises.size,
      toolCallCount: context.toolCalls.size,
      hasCheckpoint: !!context.awaitingAsyncContinuation,
    })

    // Snapshot recorded errors before this attempt. If the attempt fails with
    // a retryable resume error, we roll back to this baseline before retrying
    // so a subsequent successful retry doesn't inherit the failed attempt's
    // errors (e.g. "backend stream ended before a terminal event") and get
    // mis-finalized as `error`.
    const errorsBeforeAttempt = context.errors.length

    // A resume leg that is not the last allowed attempt will be retried below
    // on a retryable stream error. Tell Go so it treats a mid-flight provider
    // error as non-terminal for the UI and suppresses the user-facing error tag
    // that a recovered retry should not show. Billing is still flushed for
    // every leg; /api/billing/update-cost records cumulative cost as a
    // monotonic top-up, so the partial retry leg and the recovered terminal leg
    // reconcile to the maximum cumulative total. Recomputed per attempt because
    // the same payload is reused across retries.
    const willRetryOnStreamError = isResume && resumeAttempt < MAX_RESUME_ATTEMPTS - 1
    const legPayload = willRetryOnStreamError
      ? { ...payload, willRetryOnStreamError: true }
      : payload

    try {
      await runStreamLoop(
        `${mothershipBaseURL}${route}`,
        {
          method: 'POST',
          headers: mothershipRequestHeaders(),
          body: JSON.stringify(legPayload),
        },
        context,
        execContext,
        loopOptions
      )
      const streamStatus = isAborted(options, context)
        ? RequestTraceV1SpanStatus.cancelled
        : context.errors.length > 0
          ? RequestTraceV1SpanStatus.error
          : RequestTraceV1SpanStatus.ok
      context.trace.endSpan(streamSpan, streamStatus)
      context.trace.setActiveSpan(undefined)
      resumeAttempt = 0
    } catch (streamError) {
      context.trace.endSpan(streamSpan, RequestTraceV1SpanStatus.error)
      context.trace.setActiveSpan(undefined)
      if (streamError instanceof BillingLimitError) {
        await handleBillingLimitResponse(streamError.userId, context, execContext, options)
        break
      }
      if (
        isResume &&
        isRetryableStreamError(streamError) &&
        resumeAttempt < MAX_RESUME_ATTEMPTS - 1
      ) {
        // Discard errors recorded during this failed attempt; we're about to
        // redo this leg and a clean retry must not finalize as `error`.
        context.errors.length = errorsBeforeAttempt
        resumeAttempt++
        const backoff = RESUME_BACKOFF_MS[resumeAttempt - 1] ?? 1000
        logger.warn('Resume stream failed, retrying', {
          attempt: resumeAttempt + 1,
          maxAttempts: MAX_RESUME_ATTEMPTS,
          backoffMs: backoff,
          error: toError(streamError).message,
        })
        await sleepWithAbort(backoff, options.abortSignal)
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
        await waitForToolIds(context, next.pendingToolCallIds)
        next = await driveSubagentChains(
          next,
          context,
          execContext,
          options,
          mothershipBaseURL,
          lifecycleWorkspaceId
        )
      }
      if (!next) break
      continuation = next
    }

    if (context.pendingToolPromises.size > 0) {
      // Bounded by the slowest pending tool's watchdog plus grace. The
      // per-tool watchdog already guarantees each promise settles; this gate
      // is the structural backstop so that no tool failure mode — known or
      // unknown — can park the checkpoint loop (and the chat's pending-stream
      // lock) forever.
      const waitBudgetMs =
        Array.from(context.pendingToolPromises.keys()).reduce(
          (max, toolCallId) =>
            Math.max(max, toolWatchdogTimeoutMs(context.toolCalls.get(toolCallId)?.name)),
          0
        ) + TOOL_WATCHDOG_RESUME_GRACE_MS
      const waitSpan = context.trace.startSpan('Wait for Tools', 'lifecycle.wait_tools', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
        waitBudgetMs,
      })
      logger.info('Waiting for in-flight tool executions before resume', {
        checkpointId: continuation.checkpointId,
        pendingCount: context.pendingToolPromises.size,
        waitBudgetMs,
      })
      const settledInTime = await Promise.race([
        Promise.allSettled(context.pendingToolPromises.values()).then(() => true),
        sleep(waitBudgetMs).then(() => false),
      ])
      if (!settledInTime) {
        const hungToolCallIds = Array.from(context.pendingToolPromises.keys())
        logger.error('Pending tool executions exceeded the resume wait budget; force-failing', {
          checkpointId: continuation.checkpointId,
          waitBudgetMs,
          hungToolCallIds,
        })
        for (const toolCallId of hungToolCallIds) {
          await forceFailHungToolCall(
            toolCallId,
            context,
            'Tool execution hung on the Sim executor and was abandoned so the conversation could continue.'
          )
          context.pendingToolPromises.delete(toolCallId)
        }
      }
      waitSpan.attributes = { ...waitSpan.attributes, settledInTime }
      context.trace.endSpan(waitSpan)
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

    const results: Array<{
      callId: string
      name: string
      data: unknown
      success: boolean
    }> = []
    for (const toolCallId of continuation.pendingToolCallIds) {
      if (isAborted(options, context)) {
        cancelPendingTools(context)
        context.awaitingAsyncContinuation = undefined
        break
      }
      const tool = context.toolCalls.get(toolCallId)
      if (!tool || !tool.result) {
        logger.error('Missing tool result for pending tool call', {
          toolCallId,
          checkpointId: continuation.checkpointId,
          hasToolEntry: !!tool,
          toolName: tool?.name,
          toolStatus: tool?.status,
          hasPendingPromise: context.pendingToolPromises.has(toolCallId),
        })
        throw new Error(`Cannot resume: missing result for pending tool call ${toolCallId}`)
      }
      results.push({
        callId: toolCallId,
        name: tool.name || '',
        data: getToolCallTerminalData(tool),
        success: requireToolCallStateResult(tool).success,
      })
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
      checkpointId: continuation.checkpointId,
      userId: options.userId,
      ...(lifecycleWorkspaceId ? { workspaceId: lifecycleWorkspaceId } : {}),
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

// ---------------------------------------------------------------------------
// Execution context builder
// ---------------------------------------------------------------------------

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
  }
): Promise<ExecutionContext> {
  const { userId, workflowId, workspaceId, chatId, executionId, runId, abortSignal } = params
  const userTimezone =
    typeof requestPayload?.userTimezone === 'string' ? requestPayload.userTimezone : undefined
  const requestMode = typeof requestPayload?.mode === 'string' ? requestPayload.mode : undefined
  const userPermission =
    typeof requestPayload?.userPermission === 'string' ? requestPayload.userPermission : undefined

  let execContext: ExecutionContext
  if (workflowId) {
    execContext = await prepareExecutionContext(userId, workflowId, chatId)
  } else {
    const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      chatId,
      decryptedEnvVars,
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
}): Promise<{ executionId?: string; runId?: string }> {
  if (!input.chatId || input.executionId || input.runId) {
    return {
      executionId: input.executionId,
      runId: input.runId,
    }
  }

  const executionId = generateId()
  const runId = generateId()

  try {
    await createRunSegment({
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
    return { executionId, runId }
  } catch (error) {
    logger.warn('Failed to create headless run identity', {
      chatId: input.chatId,
      messageId: input.messageId,
      error: toError(error).message,
    })
    return {}
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adds `enterpriseByokEligible: true` to the initial mothership payload when the
 * workspace is on an enterprise plan. BYOK is mothership-only, so non-mothership
 * routes (e.g. `/api/copilot`) are left untouched. Failures default to hosted.
 */
async function withByokEligibilityHint(
  payload: Record<string, unknown>,
  route: string,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  // The eligibility hint is server-authoritative: always overwrite any
  // client-supplied value with a server-derived boolean so a client can never
  // assert its own eligibility. (Copilot's ValidateBYOK is the final authority,
  // but the hint must never originate from the client.) BYOK is mothership-only;
  // everything else gets an explicit false.
  let eligible = false
  if (workspaceId && route.startsWith('/api/mothership')) {
    try {
      eligible = await isWorkspaceOnEnterprisePlan(workspaceId)
    } catch (error) {
      logger.warn('Failed to resolve BYOK eligibility; defaulting to hosted', {
        workspaceId,
        error: toError(error).message,
      })
    }
  }
  return { ...payload, enterpriseByokEligible: eligible }
}

function isAborted(options: CopilotLifecycleOptions, context: StreamingContext): boolean {
  return !!(options.abortSignal?.aborted || context.wasAborted)
}

function cancelPendingTools(context: StreamingContext): void {
  for (const [, toolCall] of context.toolCalls) {
    if (toolCall.status === 'pending' || toolCall.status === 'executing') {
      setTerminalToolCallState(toolCall, {
        status: MothershipStreamV1ToolOutcome.cancelled,
        error: 'Stopped by user',
      })
    }
  }
}

function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false
  }
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && error.status >= 500
  }
  if (error instanceof TypeError) {
    return true
  }
  return false
}

function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    return sleep(ms)
  }
  if (abortSignal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })
  })
}
