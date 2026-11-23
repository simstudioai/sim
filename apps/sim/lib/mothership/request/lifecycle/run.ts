import type { Context } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isPlainRecord, omit } from '@sim/utils/object'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import { getBenchmarkMothershipUrl } from '@/lib/benchmarks/config'
import {
  type AttributedBillingRequestEnvelope,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  createAttributedBillingRequestEnvelope,
} from '@/lib/billing/core/attribution'
import { payerHasChatAccess } from '@/lib/billing/core/chat-access'
import { env } from '@/lib/core/config/env'
import { isCopilotToolPermissionsEnabled, isHosted } from '@/lib/core/config/env-flags'
import { withFileOwnerContext } from '@/lib/mothership/application/file-owner-context'
import { SIM_TOOL_EXECUTION_LEASE_SECONDS } from '@/lib/mothership/async-runs/execution-lease'
import type { AsyncCompletionSignal } from '@/lib/mothership/async-runs/lifecycle'
import {
  createRunSegment,
  getChatViewDesktopLeaseRemainingMs,
  updateRunStatus,
} from '@/lib/mothership/async-runs/repository'
import type { CopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import {
  CLIENT_TOOL_RESULT_TIMEOUT_MS,
  TOOL_WATCHDOG_RESUME_GRACE_MS,
} from '@/lib/mothership/constants'
import {
  type CopilotEnvironmentContext,
  prepareCopilotEnvironmentContext,
} from '@/lib/mothership/environment-context'
import { isMothershipModelSelectorEnabled } from '@/lib/mothership/feature-flags'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { ResumeRequest, StreamResponseReceipt } from '@/lib/mothership/generated/protocol'
import { CopilotDegradedReason } from '@/lib/mothership/observability/trace-attribute-values'
import { getAutoAllowedTools } from '@/lib/mothership/persistence/tool-permission/auto-allow'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/mothership/request/context/result'
import { resolveEnterpriseByokKey } from '@/lib/mothership/request/enterprise-byok'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import {
  authorizeLifecycleContinuation,
  restoreBillingAdmission,
} from '@/lib/mothership/request/lifecycle/admission'
import type { DurableStreamKind } from '@/lib/mothership/request/lifecycle/durable-run'
import { StreamRetryWindow } from '@/lib/mothership/request/lifecycle/stream-retry'
import { recordDegraded } from '@/lib/mothership/request/metrics'
import { StreamControllerSupersededError } from '@/lib/mothership/request/session/controller-lease'
import { turnFailure } from '@/lib/mothership/request/session/turn-failure'
import {
  getToolCallTerminalData,
  requireToolCallStateResult,
  setTerminalToolCallState,
} from '@/lib/mothership/request/tool-call-state'
import {
  handleBillingLimitResponse,
  handleChatPlanRequiredResponse,
} from '@/lib/mothership/request/tools/billing'
import {
  executeToolAndReport,
  failPendingToolCall,
  pendingToolWaitBudgetMs,
} from '@/lib/mothership/request/tools/executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'
import {
  BillingLimitError,
  CopilotBackendError,
  runStreamLoop,
} from '@/lib/mothership/request/worker/stream'
import {
  createProviderToolCallIdentity,
  restoreProviderToolCallId,
} from '@/lib/mothership/request/worker/tool-call-identity'
import {
  NO_SECRET_AUTHORITY,
  normalizeSecretMountPolicy,
  type SecretMountPolicy,
  type TurnSecretAuthority,
} from '@/lib/mothership/secret-mount-policy'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import { prepareExecutionContext } from '@/lib/mothership/tools/handlers/context'
import { getSimConnection } from '@/lib/mothership/transport/connection'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { filterModelSafeWorkspaceFileAttachments } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { appendUnavailableAttachmentNotice } from '@/lib/uploads/utils/model-input'
import type { ExecutorDelegationOrigin } from '@/executor/types'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotLifecycle')

/** After a renewed lease's end, the wait looks once more before it calls the call lost. */
const LEASE_RECHECK_SLACK_MS = 1_000
/** How soon a failed lease lookup is tried again. */
const LEASE_LOOKUP_RETRY_MS = 5_000
/** How long one lease lookup may take before it counts as failed. */
const LEASE_LOOKUP_TIMEOUT_MS = 5_000

/** The resume wait's watch over one pending tool call. */
interface PendingToolWatchdog {
  promise: Promise<AsyncCompletionSignal>
  settlement: Promise<{ toolCallId: string; promise: Promise<AsyncCompletionSignal> }>
  deadlineAt: number
  waitBudgetMs: number
  /** When this wait began. */
  startedAt: number
  /** Past this, the call is given up however its lease stands: any client tool's cap. */
  ceilingAt: number
  /** Why the deadline was moved past the plain budget, if it was. */
  extendedBy?: 'lease' | 'lease_lookup'
  /** Until when a failing lease lookup is retried before the call is given up. */
  leaseLookupRetryUntil?: number
}

/** Why a pending call's wait ran out, in the words its force-fail is logged with. */
function pendingToolExpiryMessage(watchdog: PendingToolWatchdog, now: number): string {
  if (!watchdog.extendedBy)
    return 'Pending tool execution exceeded its resume wait budget; force-failing'
  if (now >= watchdog.ceilingAt)
    return 'Pending tool execution reached the client tool result cap; force-failing'
  if (watchdog.leaseLookupRetryUntil !== undefined)
    return 'Pending tool execution lease could not be read for a whole lease; force-failing'
  return 'Pending tool execution has no live lease past its budget; force-failing'
}

/** A pending call's chat-view lease, or why it could not be read within `timeoutMs`. */
async function readLeaseWithin(
  toolCallId: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<{ remainingMs: number | null } | { error: unknown }> {
  const lookup = getChatViewDesktopLeaseRemainingMs(toolCallId).then(
    (remainingMs) => ({ remainingMs }),
    (error: unknown) => ({ error })
  )
  const giveUp = new AbortController()
  const signal = abortSignal ? AbortSignal.any([abortSignal, giveUp.signal]) : giveUp.signal
  try {
    return await Promise.race([
      lookup,
      interruptibleSleep(timeoutMs, signal).then(() => ({
        error: new Error(`The lease lookup took longer than ${timeoutMs} ms`),
      })),
    ])
  } finally {
    giveUp.abort()
  }
}

const COPILOT_MODEL_CONTENT_PROJECTION_ERROR = 'Copilot model input could not be safely projected'

/**
 * Shown when the worker ends a turn with an error terminal but gives no reason. Every surface
 * (Chat, workflow execute, inbox) reports it, so it carries no surface-specific next step.
 */
const ENDED_RUN_MESSAGE = 'This run had already ended before it could continue.'

class CopilotModelContentProjectionError extends Error {
  constructor() {
    super(COPILOT_MODEL_CONTENT_PROJECTION_ERROR)
    this.name = 'CopilotModelContentProjectionError'
  }
}

async function prepareInitialCopilotAttachmentsForModel(
  payload: Record<string, unknown>,
  workspaceId?: string
): Promise<Record<string, unknown>> {
  let projected = payload
  let omittedCount = 0
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
    omittedCount += attachments.length - safeAttachments.length
    logger.warn('Omitting Copilot attachments with unsafe secret provenance', {
      attachmentCount: attachments.length,
      omittedCount: attachments.length - safeAttachments.length,
    })
    projected =
      safeAttachments.length > 0 ? { ...projected, [key]: safeAttachments } : omit(projected, [key])
  }
  if (omittedCount === 0) return projected

  if (typeof projected.message === 'string') {
    projected = {
      ...projected,
      message: appendUnavailableAttachmentNotice(projected.message, omittedCount),
    }
  }
  if (Array.isArray(projected.messages)) {
    const messages: unknown[] = [...projected.messages]
    let notified = false
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (!isPlainRecord(message) || message.role !== 'user' || typeof message.content !== 'string')
        continue
      messages[index] = {
        ...message,
        content: appendUnavailableAttachmentNotice(message.content, omittedCount),
      }
      notified = true
      break
    }
    if (!notified) {
      messages.push({ role: 'user', content: appendUnavailableAttachmentNotice('', omittedCount) })
    }
    projected = { ...projected, messages }
  } else if (typeof projected.message !== 'string') {
    projected = { ...projected, message: appendUnavailableAttachmentNotice('', omittedCount) }
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
      (await prepareCopilotEnvironmentContext(options.userId, options.workspaceId, {
        includeSecrets: execContext.requestMode !== 'assistant' && !execContext.organizationId,
      }))
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
  /** Internal benchmark runner policy, independent of browser and model payloads. */
  benchmark?: 'plan' | 'tool-free' | 'distill' | 'reconstruct' | 'resolve'
  copilotResourceAdmission?: CopilotResourceAdmission
  /** Trusted entry point for Search metering; never read from model arguments. */
  searchSurface?: 'copilot' | 'slack'
  mcpBlockId?: string
  executorDelegationOrigin?: ExecutorDelegationOrigin
  userId: string
  workflowId?: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  executionId?: string
  runId?: string
  workerRoute?: string
  /** Reattach this existing run; workerRoute still identifies the original interaction surface. */
  recovery?: {
    kind?: DurableStreamKind
    billingAdmission?: { billingRequestId: string; serializedAttribution: string }
    streamId: string
    events: readonly StreamEvent[]
    userTimezone?: string
    requestMode?: string
  }
  simRequestId?: string
  otelContext?: Context
  executionContext?: ExecutionContext
  billingAttribution?: BillingAttributionSnapshot
  onBillingAdmission?: (admission: AttributedBillingRequestEnvelope) => Promise<void>
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
 * else would hang the turn until the permission wait expires with nothing to click.
 */
async function resolveToolPermissions(
  options: CopilotLifecycleOptions
): Promise<StreamingContext['toolPermissions']> {
  const enabled =
    isCopilotToolPermissionsEnabled &&
    options.interactive !== false &&
    (options.workerRoute ?? '').startsWith('/api/mothership')
  if (!enabled) return { enabled: false, autoAllowed: new Set(), autoAllowPermitted: true }

  /**
   * permission-group-enforced: copilot.tool_auto_approval — read at the point
   * the decision is made, not only where one is saved. A member who clicked
   * "always allow" before the key was set would otherwise keep the prompt
   * silenced forever, so the stored list is not even loaded once the group
   * withholds the capability.
   *
   * A failed lookup reads as withheld, matching the decision endpoint: letting
   * it reject would abort the whole turn here, before any card is drawn, over a
   * database hiccup — the turn is interactive by construction at this point, so
   * there is a human to ask. Withholding keeps the capability fail-closed
   * without wedging the turn: no stored always-allow is loaded, nothing durable
   * is remembered, and every gated call still asks its one-time question.
   */
  const withheld =
    options.userId && options.workspaceId
      ? await isWorkspaceCapabilityWithheld(
          options.userId,
          options.workspaceId,
          'copilot.tool_auto_approval'
        ).catch((error) => {
          logger.warn('Could not resolve the tool auto-approval capability; prompting every time', {
            workspaceId: options.workspaceId,
            error: getErrorMessage(error),
          })
          return true
        })
      : false
  if (withheld) {
    return { enabled: true, autoAllowed: new Set(), autoAllowPermitted: false }
  }

  return {
    enabled: true,
    autoAllowed: await getAutoAllowedTools(options.userId, options.chatId),
    autoAllowPermitted: true,
  }
}

export async function runCopilotLifecycle(
  requestPayload: Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const {
    userId,
    workflowId,
    workspaceId,
    organizationId,
    chatId,
    executionId,
    runId,
    workerRoute = '/api/copilot',
  } = options
  const isContinuation = Boolean(options.recovery) || workerRoute === '/api/tools/resume'
  const payloadMode = nonBlankString(requestPayload.mode)
  const requestMode = options.recovery
    ? payloadMode
    : workerRoute === '/api/tools/resume'
      ? (options.executionContext?.requestMode ?? payloadMode)
      : payloadMode
  if (
    (options.recovery?.requestMode !== undefined &&
      (payloadMode !== undefined || options.recovery.requestMode === 'assistant') &&
      (options.recovery.requestMode === 'build' ? 'agent' : options.recovery.requestMode) !==
        (payloadMode ?? 'agent')) ||
    (isContinuation && requestPayload.mode !== undefined && requestPayload.mode !== requestMode)
  ) {
    throw new Error('Recovered execution mode does not match its saved request')
  }
  if (
    organizationId &&
    (workspaceId || workflowId || !['assistant', 'agent', 'plan'].includes(requestMode ?? ''))
  ) {
    throw new Error(
      'Organization conversations require an explicit mode without workspace or workflow scope'
    )
  }
  const payloadMsgId =
    options.recovery?.streamId ??
    (typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : generateId())
  const secretAuthority = turnSecretAuthority(userId, requestMode, options)
  const runIdentity = await ensureHeadlessRunIdentity({
    requestPayload,
    userId,
    workflowId,
    workspaceId,
    organizationId,
    chatId,
    executionId,
    runId,
    messageId: payloadMsgId,
    secretAuthority,
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
            },
          }
        : {}),
    }

    const execContext =
      lifecycleOptions.executionContext ??
      (await buildExecutionContext(
        { ...requestPayload, ...(requestMode ? { mode: requestMode } : {}) },
        {
          userId,
          workflowId,
          workspaceId,
          organizationId,
          chatId,
          executionId: resolvedExecutionId,
          runId: resolvedRunId,
          abortSignal: lifecycleOptions.abortSignal,
          billingAttribution: lifecycleOptions.billingAttribution,
          resolvedSecretTraceRegistry: lifecycleOptions.resolvedSecretTraceRegistry,
          environmentContext: lifecycleOptions.environmentContext,
          userPermission: lifecycleOptions.userPermission,
        }
      ))
    if (
      organizationId &&
      (execContext.userId !== userId ||
        execContext.organizationId !== organizationId ||
        execContext.workspaceId ||
        execContext.workflowId ||
        execContext.chatId !== chatId)
    ) {
      throw new Error('Organization execution context does not match its authenticated scope')
    }
    execContext.messageId = payloadMsgId
    execContext.secretMountPolicy = secretAuthority.secretMountPolicy
    execContext.secretActorUserId = secretAuthority.secretActorUserId
    execContext.benchmark = options.benchmark
    if (lifecycleOptions.copilotResourceAdmission)
      execContext.copilotResourceAdmission = lifecycleOptions.copilotResourceAdmission
    if (options.recovery?.userTimezone) execContext.userTimezone = options.recovery.userTimezone
    execContext.requestMode = requestMode
    execContext.searchSurface = lifecycleOptions.searchSurface ?? 'copilot'
    if (lifecycleOptions.mcpBlockId) {
      execContext.mcpBlockId = lifecycleOptions.mcpBlockId
      execContext.executorDelegationOrigin = lifecycleOptions.executorDelegationOrigin
    }
    if (execContext.requestMode === 'assistant' || execContext.organizationId) {
      execContext.assistantSearch = workspaceSearchFiltersSchema.parse(
        isContinuation
          ? (execContext.assistantSearch ?? requestPayload.assistantSearch ?? {})
          : (requestPayload.assistantSearch ?? {})
      )
    }
    execContext.copilotInteractionMode =
      lifecycleOptions.interactive === true ? 'interactive' : 'headless'
    if (
      isHosted &&
      (!(execContext.workspaceId || execContext.organizationId) || !execContext.billingAttribution)
    ) {
      throw new Error('Billing attribution is required for hosted Copilot execution')
    }
    const restoredAdmission = options.recovery?.billingAdmission
      ? restoreBillingAdmission(options.recovery.billingAdmission, {
          userId,
          workspaceId,
          organizationId,
        })
      : undefined
    if (options.recovery && isHosted && !restoredAdmission)
      throw new Error('Hosted recovery is missing its original billing admission')
    if (restoredAdmission) execContext.billingAttribution = restoredAdmission.attribution
    let hostedBillingRequest: AttributedBillingRequestEnvelope | undefined =
      restoredAdmission?.envelope
    if (execContext.billingAttribution) {
      const billingAttribution = assertBillingAttributionSnapshot(execContext.billingAttribution)
      if (
        billingAttribution.actorUserId !== execContext.userId ||
        billingAttribution.workspaceId !== (execContext.workspaceId ?? null) ||
        (execContext.organizationId !== undefined &&
          billingAttribution.organizationId !== execContext.organizationId)
      ) {
        throw new Error('Copilot billing attribution does not match its actor and workspace')
      }
      execContext.billingAttribution = billingAttribution
      if (isHosted && !hostedBillingRequest) {
        hostedBillingRequest = createAttributedBillingRequestEnvelope(billingAttribution)
      }
    }

    const context = createStreamingContext({
      chatId,
      requestId: lifecycleOptions.simRequestId,
      executionId: resolvedExecutionId,
      runId: resolvedRunId,
      messageId: payloadMsgId,
      providerToolCallIdentity:
        workerRoute === '/api/tools/resume'
          ? undefined
          : createProviderToolCallIdentity(resolvedRunId ?? generateId()),
      toolPermissions: await resolveToolPermissions(lifecycleOptions),
    })
    if (options.recovery) {
      const { restoreStreamingContext } = await import('@/lib/mothership/request/context/restore')
      await restoreStreamingContext(options.recovery.events, context, execContext)
    }
    let onCompleteStarted = false

    try {
      // Hosted admission (plan and usage limits) belongs HERE, at dispatch, with the attribution
      // already in hand: the worker does not call api-keys/validate for a turn Sim
      // dispatches, so without this gate the limit check never runs. On exceeded, the same synthetic
      // 402 UX as the mid-stream path renders the upgrade prompt, the backend is never
      // dispatched, and the shared verdict assembly below runs exactly as after a
      // mid-stream billing break.
      const admittedAttribution =
        isHosted && !isContinuation && execContext.billingAttribution
          ? assertBillingAttributionSnapshot(execContext.billingAttribution)
          : undefined
      // The free plan does not include Chat, on any surface that starts a run: such a payer's
      // turn ends here with the upgrade card, before usage is read or the backend dispatched.
      const chatPlanRequired =
        admittedAttribution !== undefined && !(await payerHasChatAccess(admittedAttribution))
      const admission =
        admittedAttribution && !chatPlanRequired
          ? await checkAttributedUsageLimits(admittedAttribution)
          : { isExceeded: false as const }
      if (options.recovery && context.completionStatus) {
        // The worker terminal was already delivered before the relay died.
        // Rebuild persistence from that receipt without charging its usage twice.
      } else if (chatPlanRequired) {
        await handleChatPlanRequiredResponse(context, execContext, lifecycleOptions)
      } else if (admission.isExceeded) {
        await handleBillingLimitResponse(
          execContext.userId,
          context,
          execContext,
          lifecycleOptions,
          'scope' in admission ? admission.scope : undefined
        )
      } else {
        if (!isContinuation && hostedBillingRequest)
          await lifecycleOptions.onBillingAdmission?.(hostedBillingRequest)
        await ensureModelEgressRegistry(execContext, lifecycleOptions)
        const modelSafeRequestPayload = await prepareInitialCopilotAttachmentsForModel(
          requestPayload,
          lifecycleOptions.workspaceId
        )
        try {
          await runCheckpointLoop(
            modelSafeRequestPayload,
            context,
            execContext,
            lifecycleOptions,
            workerRoute,
            hostedBillingRequest
          )
        } catch (error) {
          // A continuation refused on spend, or a worker 402 on any leg, ends the turn with the
          // same card as a refused dispatch and stops the worker run.
          if (!(error instanceof BillingLimitError)) throw error
          context.awaitingAsyncContinuation = undefined
          await handleBillingLimitResponse(
            error.userId,
            context,
            execContext,
            lifecycleOptions,
            error.scope
          )
          await stopWorkerRunAfterUsageRefusal(context.messageId, execContext)
        }
      }

      // The backend's terminal `complete` is the turn's verdict. A failure it
      // reported in-band on the way there — a tool or a subagent that failed and
      // was handed back to the model as data — belongs to a turn that still
      // finished, so it must not turn the whole request into an error and discard
      // the work the user watched succeed.
      const backendFinishedTurn =
        context.completionStatus === MothershipStreamV1CompletionStatus.complete
      // A turn failure (such as a refused replay write) aborts the turn to stop it, but
      // the turn failed; it was not stopped by the user.
      const failure = turnFailure(lifecycleOptions.abortSignal?.reason)
      // Consult the lifecycle signal as well as the flag, as the throw path below does:
      // a Stop can land without the stream ever reporting it.
      const turnWasAborted =
        !failure &&
        (context.completionStatus === MothershipStreamV1CompletionStatus.cancelled ||
          context.wasAborted ||
          (lifecycleOptions.abortSignal?.aborted ?? false))
      const succeeded =
        !failure &&
        !turnWasAborted &&
        (backendFinishedTurn || (!context.completionStatus && context.errors.length === 0))
      // The worker sends an error terminal with no `error` event only when it replays a run
      // that already ended (for example at its deadline) to a resume or reattach, because
      // that replay does not carry the run's stored reason. Say so rather than leave the turn
      // to a generic failure; a reported reason or a turn failure always wins.
      const endedWithoutReason =
        !turnWasAborted &&
        context.completionStatus === MothershipStreamV1CompletionStatus.error &&
        context.errors.length === 0

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
        ...(endedWithoutReason ? { error: ENDED_RUN_MESSAGE } : {}),
        ...(failure ? { error: failure.userMessage, errorCode: failure.code } : {}),
        errors: !succeeded && context.errors.length ? context.errors : undefined,
        usage: context.usage,
        cost: context.cost,
      }
      await lifecycleOptions.assertControllerOwnership?.()
      if (lifecycleOptions.onComplete) {
        onCompleteStarted = true
        await lifecycleOptions.onComplete(result)
      }
      terminalResult = result
      return result
    } catch (error) {
      if (error instanceof StreamControllerSupersededError) throw error
      await lifecycleOptions.assertControllerOwnership?.()
      const err = toError(error)
      // A CopilotBackendError carries the upstream HTTP status + body (e.g. a 5xx
      // from /api/tools/resume when an oversized tool result — a rendered-doc
      // image — is posted back). Log those so a client-side "Stream error" that
      // originates from a thrown backend leg (vs an `error` SSE event) is
      // explained, not just reduced to a message string.
      logger.error('Copilot orchestration failed', {
        error: err.message,
        ...causeForLog(err),
        name: err.name,
        ...(error instanceof CopilotBackendError
          ? { backendStatus: error.status, backendBody: error.body?.slice(0, 2000) }
          : {}),
      })
      // If the abort signal fired, this throw is a consequence of the
      // cancel (publisher.publish fails once the client disconnects, a
      // downstream worker read throws on cancel, etc.) — NOT a real
      // backend error. Don't invoke `onError`, because on the cancel
      // path `onComplete(cancelled)` persists partial content with an
      // idempotent row-locked finalizer. `onError` would race with it via
      // `finalizeAssistantTurn`, clearing `conversationId` before the
      // partial content can be appended.
      // Return `cancelled: true` so upstream classification stays
      // consistent with the success-path cancel result.
      const failure = turnFailure(lifecycleOptions.abortSignal?.reason)
      const wasCancelled = !failure && (lifecycleOptions.abortSignal?.aborted ?? false)
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
        error: failure?.userMessage ?? err.message,
        ...(failure ? { errorCode: failure.code } : {}),
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
  const providerToolCallId = restoreProviderToolCallId(toolCallId, context.providerToolCallIdentity)
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
    callId: providerToolCallId,
    name: tool.name || '',
    data: getToolCallTerminalData(tool),
    success: requireToolCallStateResult(tool).success,
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
  const mothershipBaseURL = options.benchmark
    ? getBenchmarkMothershipUrl()
    : await getMothershipBaseURL({ userId: options.userId })
  execContext.mothershipBaseURL = mothershipBaseURL
  if (
    initialRoute === '/api/mothership' ||
    initialRoute === '/api/copilot' ||
    (initialRoute === '/api/mothership/execute' && options.benchmark)
  ) {
    const simConnection = getSimConnection(options.benchmark ? 'checkpoint' : undefined)
    payload = { ...payload, simConnection }
  }
  const lifecycleWorkspaceId = nonBlankString(options.workspaceId)
  const lifecycleOrganizationId = nonBlankString(execContext.organizationId)
  const mothershipRequestId = nonBlankString(options.simRequestId) ?? generateId()
  if (!options.simRequestId) {
    options = { ...options, simRequestId: mothershipRequestId }
  }
  const systemPromptOverride = env.MSHIP_SYSPROMPT_OVERRIDE

  if (
    !options.benchmark &&
    initialRoute !== '/api/tools/resume' &&
    typeof systemPromptOverride === 'string' &&
    systemPromptOverride.trim() !== ''
  ) {
    payload = { ...payload, systemPromptOverride }
  }

  /**
   * The initial turn needs its workspace for pooled and member spend admission.
   * Resumes recheck current access using the original scope and payer without
   * repeating spend admission. The same rule applies to both worker backends.
   */
  if (
    initialRoute !== '/api/tools/resume' &&
    lifecycleWorkspaceId &&
    !nonBlankString(payload.workspaceId)
  ) {
    payload = { ...payload, workspaceId: lifecycleWorkspaceId }
  }

  if (lifecycleOrganizationId && initialRoute !== '/api/tools/resume') {
    if (
      lifecycleWorkspaceId ||
      execContext.workspaceId ||
      execContext.workflowId ||
      !['assistant', 'agent', 'plan'].includes(execContext.requestMode ?? '') ||
      !execContext.chatId ||
      nonBlankString(payload.workspaceId) ||
      (nonBlankString(payload.organizationId) && payload.organizationId !== lifecycleOrganizationId)
    ) {
      throw new Error('Organization execution scope does not match the request')
    }
    payload = { ...payload, organizationId: lifecycleOrganizationId, chatId: execContext.chatId }
  }

  payload = await withFileOwnerContext(payload, execContext, mothershipBaseURL, initialRoute)

  for (;;) {
    await options.assertControllerOwnership?.()
    context.streamComplete = false
    if (isAborted(options, context)) {
      cancelPendingTools(context)
      context.awaitingAsyncContinuation = undefined
      break
    }
    const isResume = route === '/api/tools/resume'
    if (isResume || options.recovery) await authorizeLifecycleContinuation(execContext)

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
        retry?.recovered()
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
    logger.info('Starting stream loop', {
      route,
      isResume,
      resumeAttempt: retry.attempts,
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
      retry = undefined
    } catch (streamError) {
      const backoff = retry?.nextDelay(streamError, options.abortSignal) ?? null
      if (backoff !== null) {
        /** A recovered connection must not finalize with an earlier transport failure. */
        context.errors.length = errorsBeforeAttempt
        logger.warn(
          isResume ? 'Resume stream failed, retrying' : 'Initial stream failed, retrying',
          {
            attempt: (retry?.attempts ?? 0) + 1,
            backoffMs: backoff,
            error: toError(streamError).message,
            ...causeForLog(streamError),
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

    const continuation = context.awaitingAsyncContinuation
    if (!continuation) break

    if (context.pendingToolPromises.size > 0) {
      let maximumWaitBudgetMs = 0
      const pendingWatchdogs = new Map<string, PendingToolWatchdog>()

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
          const toolCall = context.toolCalls.get(toolCallId)
          const waitBudgetMs =
            pendingToolWaitBudgetMs(toolCall, context.desktopDeviceId) +
            TOOL_WATCHDOG_RESUME_GRACE_MS
          const clientCapAt = now + Math.max(waitBudgetMs, CLIENT_TOOL_RESULT_TIMEOUT_MS)
          // Neither the wait nor a lease carries a call past the deadline the worker named for it.
          const ceilingAt =
            toolCall?.deadlineAt === undefined
              ? clientCapAt
              : Math.min(clientCapAt, toolCall.deadlineAt + TOOL_WATCHDOG_RESUME_GRACE_MS)
          pendingWatchdogs.set(toolCallId, {
            promise,
            settlement: promise.then(
              () => ({ toolCallId, promise }),
              () => ({ toolCallId, promise })
            ),
            deadlineAt: Math.min(now + waitBudgetMs, ceilingAt),
            waitBudgetMs,
            startedAt: now,
            ceilingAt,
          })
          maximumWaitBudgetMs = Math.max(maximumWaitBudgetMs, waitBudgetMs)
        }

        const overdueTools = Array.from(pendingWatchdogs.entries()).filter(
          ([toolCallId, watchdog]) =>
            watchdog.deadlineAt <= now &&
            context.pendingToolPromises.get(toolCallId) === watchdog.promise
        )
        // A desktop import the chat view is running renews its lease while it works: its budget
        // runs to the end of that lease, and only a lapsed lease fails it. At its ceiling a call is
        // given up however its lease stands, so its lease is not read.
        // A lookup that fails says nothing about the lease, so it is retried, for at most one lease.
        // Each lookup is bounded, so a stalled read cannot hold the wait past its deadlines or Stop.
        const leaseChecked = overdueTools.filter(([, watchdog]) => now < watchdog.ceilingAt)
        const leases = await Promise.all(
          leaseChecked.map(([toolCallId]) =>
            readLeaseWithin(toolCallId, LEASE_LOOKUP_TIMEOUT_MS, options.abortSignal)
          )
        )
        if (isAborted(options, context)) break
        const expiredTools = [
          ...overdueTools.filter(
            ([toolCallId, watchdog]) =>
              now >= watchdog.ceilingAt &&
              context.pendingToolPromises.get(toolCallId) === watchdog.promise
          ),
          ...leaseChecked.filter(([toolCallId, watchdog], index) => {
            // A call replaced while its lease was read belongs to its new watchdog.
            if (context.pendingToolPromises.get(toolCallId) !== watchdog.promise) return false
            const lease = leases[index]
            const checkedAt = Date.now()
            const extendTo = (deadlineAt: number, reason: 'lease' | 'lease_lookup') => {
              watchdog.deadlineAt = Math.min(deadlineAt, watchdog.ceilingAt)
              watchdog.extendedBy = reason
              maximumWaitBudgetMs = Math.max(
                maximumWaitBudgetMs,
                watchdog.deadlineAt - watchdog.startedAt
              )
              return false
            }
            if ('error' in lease) {
              watchdog.leaseLookupRetryUntil ??= checkedAt + SIM_TOOL_EXECUTION_LEASE_SECONDS * 1000
              if (checkedAt >= watchdog.leaseLookupRetryUntil) return true
              logger.warn('Could not read a pending tool call lease; checking again', {
                toolCallId,
                error: getErrorMessage(lease.error),
              })
              return extendTo(checkedAt + LEASE_LOOKUP_RETRY_MS, 'lease_lookup')
            }
            watchdog.leaseLookupRetryUntil = undefined
            if (typeof lease.remainingMs !== 'number' || lease.remainingMs <= 0) return true
            return extendTo(checkedAt + lease.remainingMs + LEASE_RECHECK_SLACK_MS, 'lease')
          }),
        ]
        if (expiredTools.length > 0) {
          await Promise.all(
            expiredTools.map(async ([toolCallId, watchdog]) => {
              const waitedMs = Date.now() - watchdog.startedAt
              logger.error(pendingToolExpiryMessage(watchdog, now), {
                checkpointId: continuation.checkpointId,
                toolCallId,
                waitBudgetMs: watchdog.waitBudgetMs,
                waitedMs,
                ...(watchdog.extendedBy ? { extendedBy: watchdog.extendedBy } : {}),
              })
              await failPendingToolCall(toolCallId, context, execContext)
              if (context.pendingToolPromises.get(toolCallId) === watchdog.promise) {
                context.pendingToolPromises.delete(toolCallId)
              }
              pendingWatchdogs.delete(toolCallId)
            })
          )
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
    })

    context.awaitingAsyncContinuation = undefined
    route = '/api/tools/resume'
    payload = {
      streamId: context.messageId,
      results,
    } satisfies ResumeRequest

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
    organizationId?: string
    chatId?: string
    executionId?: string
    runId?: string
    abortSignal?: AbortSignal
    billingAttribution?: BillingAttributionSnapshot
    resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    environmentContext?: CopilotEnvironmentContext
    userPermission?: PermissionType
  }
): Promise<ExecutionContext> {
  const {
    userId,
    workflowId,
    workspaceId,
    organizationId,
    chatId,
    executionId,
    runId,
    abortSignal,
    billingAttribution,
    resolvedSecretTraceRegistry,
    environmentContext,
    userPermission,
  } = params
  const userTimezone =
    typeof requestPayload?.userTimezone === 'string' ? requestPayload.userTimezone : undefined
  const requestMode = typeof requestPayload?.mode === 'string' ? requestPayload.mode : undefined

  let execContext: ExecutionContext
  if (workflowId && requestMode !== 'assistant') {
    execContext = await prepareExecutionContext(userId, workflowId, chatId, {
      workspaceId,
      billingAttribution,
      environmentContext,
    })
  } else {
    const activeEnvironmentContext =
      environmentContext ??
      (await prepareCopilotEnvironmentContext(userId, workspaceId, {
        includeSecrets: requestMode !== 'assistant' && !organizationId,
      }))
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      organizationId,
      chatId,
      ...activeEnvironmentContext,
      billingAttribution,
    }
  }

  if (userTimezone) execContext.userTimezone = userTimezone
  execContext.copilotToolExecution = true
  if (requestMode) execContext.requestMode = requestMode
  if (requestMode === 'assistant' || organizationId) {
    execContext.assistantSearch = workspaceSearchFiltersSchema.parse(
      requestPayload?.assistantSearch ?? {}
    )
  }
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
  return execContext
}

/**
 * The one source of a turn's secret authority: its execution context runs under it, and a
 * headless run records it so a lane that rebuilds its tool context from the worker's request — the
 * in-band tool route — re-derives it instead of defaulting. Assistant mode mounts nothing.
 */
function turnSecretAuthority(
  userId: string,
  requestMode: string | undefined,
  options: CopilotLifecycleOptions
): TurnSecretAuthority {
  if (requestMode === 'assistant') return NO_SECRET_AUTHORITY
  const secretActorUserId =
    options.secretActorUserId !== undefined
      ? options.secretActorUserId
      : options.executionContext?.secretActorUserId
  return {
    secretMountPolicy: normalizeSecretMountPolicy(
      options.secretMountPolicy ?? options.executionContext?.secretMountPolicy
    ),
    secretActorUserId: secretActorUserId === undefined ? userId : secretActorUserId,
  }
}

async function ensureHeadlessRunIdentity(input: {
  requestPayload: Record<string, unknown>
  userId: string
  workflowId?: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  executionId?: string
  runId?: string
  messageId: string
  secretAuthority: TurnSecretAuthority
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
      organizationId: input.organizationId,
      streamId: input.messageId,
      model: typeof input.requestPayload?.model === 'string' ? input.requestPayload.model : null,
      provider:
        typeof input.requestPayload?.provider === 'string' ? input.requestPayload.provider : null,
      requestContext: {
        source: 'headless_lifecycle',
        secretAuthority: input.secretAuthority,
      },
    })
    return { executionId, runId, cancelled: run.status === 'cancelled' }
  } catch (error) {
    logger.error('Headless run record could not be created', {
      chatId: input.chatId,
      streamId: input.messageId,
      error: getErrorMessage(error),
      ...causeForLog(error),
    })
    throw new Error('Chat could not start because its execution record is unavailable', {
      cause: error,
    })
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
  const refreshed = omit(payload, [
    'byokApiKey',
    /** The hidden hosted default must not override the customer-key provider pin. */
    ...(byokApiKey && !(await isMothershipModelSelectorEnabled()) ? ['modelSelection'] : []),
  ])
  return byokApiKey ? { ...refreshed, byokApiKey } : refreshed
}

/** The underlying failure behind a generic user-facing error, for logs. */
function causeForLog(error: unknown): { cause?: string } {
  const cause = error instanceof Error ? error.cause : undefined
  return cause === undefined ? {} : { cause: getErrorMessage(cause) }
}

function isAborted(options: CopilotLifecycleOptions, context: StreamingContext): boolean {
  return !!(options.abortSignal?.aborted || context.wasAborted)
}

/**
 * A refused continuation leaves the worker run parked on its checkpoint, and a parked run holds
 * the chat: the next message would be refused as busy until the sweeper expires it. Stopping it
 * frees the chat, so the message sent after an upgrade continues the conversation.
 */
async function stopWorkerRunAfterUsageRefusal(
  streamId: string,
  execContext: Pick<ExecutionContext, 'userId' | 'chatId'>
): Promise<void> {
  try {
    const { requestExplicitStreamAbort } = await import(
      '@/lib/mothership/request/session/explicit-abort'
    )
    await requestExplicitStreamAbort({
      streamId,
      userId: execContext.userId,
      chatId: execContext.chatId,
    })
  } catch (error) {
    logger.warn('Worker stop after a usage-limit refusal was not delivered', {
      streamId,
      error: getErrorMessage(error),
    })
  }
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
