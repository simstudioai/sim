import { createLogger } from '@sim/logger'
import { TERMINAL_TOOL_NAME } from '@sim/terminal-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import type { AsyncCompletionSignal } from '@/lib/copilot/async-runs/lifecycle'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  type MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
  MothershipStreamV1ToolStatus,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import {
  decisionAllowsExecution,
  decisionSuppressesFuturePrompts,
  waitForToolPermissionDecision,
} from '@/lib/copilot/persistence/tool-permission'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import { markToolResultSeen } from '@/lib/copilot/request/sse-utils'
import { setTerminalToolCallState } from '@/lib/copilot/request/tool-call-state'
import type {
  OrchestratorOptions,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { getToolEntry, toolRequiresApproval } from '@/lib/copilot/tool-executor'

const logger = createLogger('CopilotToolPermissionGate')

/**
 * Whether a `terminal` call is one worth stopping for.
 *
 * The catalog's approval flag is per tool, but the terminal tool covers both
 * running commands and merely looking at the screen. Only running one is
 * consequential; gating `read` or `list` would put a card in front of the user
 * every time the agent glanced at a terminal, which trains them to click
 * through the ones that matter.
 */
function terminalOperationNeedsApproval(args: Record<string, unknown> | undefined): boolean {
  return args?.operation === 'run'
}

/**
 * A human can take as long as they like to answer, so the wait is bounded only
 * by the overall orchestration budget rather than a per-tool watchdog.
 */
const PERMISSION_WAIT_TIMEOUT_MS = ORCHESTRATION_TIMEOUT_MS

export const TOOL_AWAITING_APPROVAL_STATUS = MothershipStreamV1ToolStatus.awaiting_approval

/**
 * Whether this call must be held for an explicit user decision.
 *
 * Headless and non-interactive runs (scheduled tasks, one-shot execute) are
 * never gated: nobody is there to answer, and blocking them would hang the run
 * until the orchestration timeout.
 */
export function toolCallNeedsApproval(
  toolName: string,
  context: StreamingContext,
  options: OrchestratorOptions,
  /**
   * True when the incoming call frame already carries `awaiting_approval`.
   * Go stamps this for resolved integration operations, whose definitions are
   * request-local and so never appear in the generated catalog.
   */
  frameRequestsApproval = false,
  /** The call's arguments, for a tool whose gate depends on what it is doing. */
  args?: Record<string, unknown>
): boolean {
  if (!context.toolPermissions.enabled) return false
  if (options.interactive === false) return false

  if (!frameRequestsApproval) {
    if (!toolRequiresApproval(toolName)) return false
    if (toolName === TERMINAL_TOOL_NAME && !terminalOperationNeedsApproval(args)) return false
    // A go-routed tool executes inside mothership and never reaches Sim's
    // dispatch, so there is nothing here to hold. Stamping the frame anyway
    // would draw a card for work that already happened, with no waiter behind
    // it. Go asks for those gates explicitly via the frame instead.
    if (getToolEntry(toolName)?.route === 'go') {
      logger.error('Tool declares requiresApproval but runs in Go, where Sim cannot gate it', {
        toolName,
      })
      return false
    }
  }

  return !context.toolPermissions.autoAllowed.has(toolName)
}

function skipOutput(toolName: string) {
  return {
    skipped: true,
    reason: 'user_declined',
    message: `The user declined to run ${toolName}. Nothing was executed.`,
  }
}

function noPromptOutput(toolName: string) {
  return {
    skipped: true,
    reason: 'no_prompt_surface',
    message: `${toolName} requires the user's permission, but it has no visible row to ask on, so it was not run.`,
  }
}

/**
 * Tell the client how a gated call ended without executing.
 *
 * Go's own tool_result for this call is suppressed (`markToolResultSeen`), so
 * this synthetic frame is the only thing that moves the row out of its
 * awaiting-approval state in the UI.
 */
async function emitGateResult(
  toolCallId: string,
  toolName: string,
  executor: MothershipStreamV1ToolExecutor,
  outcome: MothershipStreamV1ToolOutcome,
  output: unknown,
  options: OrchestratorOptions,
  error?: string
): Promise<void> {
  try {
    await options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName,
        executor,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: outcome === MothershipStreamV1ToolOutcome.skipped,
        output,
        status: outcome,
        ...(error ? { error } : {}),
      },
    })
  } catch (err) {
    logger.warn('Failed to emit permission gate tool result', {
      toolCallId,
      toolName,
      error: getErrorMessage(err),
    })
  }
}

/**
 * Re-emit the call frame as `executing` once the user allows the tool.
 *
 * Without this the card would keep offering Allow/Skip until the tool finished,
 * because no further call frame arrives from Go after a decision.
 */
async function emitApprovedCall(
  toolCallId: string,
  toolName: string,
  executor: MothershipStreamV1ToolExecutor,
  args: Record<string, unknown> | undefined,
  options: OrchestratorOptions
): Promise<void> {
  try {
    await options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName,
        executor,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        status: MothershipStreamV1ToolStatus.executing,
        ...(args ? { arguments: args } : {}),
      },
    })
  } catch (err) {
    logger.warn('Failed to emit approved tool call frame', {
      toolCallId,
      toolName,
      error: getErrorMessage(err),
    })
  }
}

/**
 * Hold a gated tool call until the user answers, then hand off to `execute`.
 *
 * The returned promise is what gets registered as the call's pending promise,
 * and it deliberately stays unsettled across both the wait AND the subsequent
 * execution. That is what keeps the mothership resume blocked: the checkpoint
 * loop waits on the pending promises before it POSTs `/api/tools/resume`, so
 * as long as this has not settled, no tool result reaches Go.
 */
export function runGatedToolExecution(
  toolCall: ToolCallState,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  executor: MothershipStreamV1ToolExecutor,
  context: StreamingContext,
  options: OrchestratorOptions,
  execute: () => Promise<AsyncCompletionSignal> | null,
  /**
   * False when the row this call would render on is hidden. Consent cannot be
   * asked for, so the call is refused instead of silently run or left to hang.
   */
  canPrompt = true
): Promise<AsyncCompletionSignal> {
  toolCall.status = 'awaiting_approval'

  return withCopilotSpan(
    TraceSpan.CopilotToolWaitForPermission,
    {
      [TraceAttr.ToolName]: toolName,
      [TraceAttr.ToolCallId]: toolCallId,
      ...(context.runId ? { [TraceAttr.RunId]: context.runId } : {}),
    },
    async (span): Promise<AsyncCompletionSignal> => {
      if (!canPrompt) {
        // Fail closed. Running it would defeat the point of the flag, and
        // waiting would hang the turn on a prompt that is never drawn.
        logger.error('Gated tool has no visible row to prompt on; refusing to run it', {
          toolCallId,
          toolName,
        })
        const output = noPromptOutput(toolName)
        setTerminalToolCallState(toolCall, {
          status: MothershipStreamV1ToolOutcome.skipped,
          output,
        })
        markToolResultSeen(toolCallId)
        await emitGateResult(
          toolCallId,
          toolName,
          executor,
          MothershipStreamV1ToolOutcome.skipped,
          output,
          options
        )
        return { status: MothershipStreamV1ToolOutcome.success, message: output.message }
      }

      const decision = await waitForToolPermissionDecision(
        toolCallId,
        PERMISSION_WAIT_TIMEOUT_MS,
        options.abortSignal
      )

      if (!decision) {
        // Timed out or the turn was stopped. Fail the call rather than running
        // it: an unanswered prompt is not consent.
        span.setAttribute(TraceAttr.ToolOutcome, MothershipStreamV1ToolOutcome.cancelled)
        const error = 'Timed out waiting for the user to approve this tool.'
        setTerminalToolCallState(toolCall, {
          status: MothershipStreamV1ToolOutcome.cancelled,
          output: { error },
          error,
        })
        markToolResultSeen(toolCallId)
        await emitGateResult(
          toolCallId,
          toolName,
          executor,
          MothershipStreamV1ToolOutcome.cancelled,
          { error },
          options,
          error
        )
        return { status: MothershipStreamV1ToolOutcome.error, message: error }
      }

      span.setAttribute(TraceAttr.CopilotAsyncToolPermissionDecision, decision.decision)

      if (decisionSuppressesFuturePrompts(decision.decision)) {
        // Same-turn effect: a second call to this tool later in the turn must
        // not re-prompt. The durable write (chat row or user settings) happens
        // in the endpoint.
        context.toolPermissions.autoAllowed.add(toolName)
      }

      if (!decisionAllowsExecution(decision.decision)) {
        const output = skipOutput(toolName)
        setTerminalToolCallState(toolCall, {
          status: MothershipStreamV1ToolOutcome.skipped,
          output,
        })
        markToolResultSeen(toolCallId)
        await emitGateResult(
          toolCallId,
          toolName,
          executor,
          MothershipStreamV1ToolOutcome.skipped,
          output,
          options
        )
        // Reported as success so a declined tool is a decision the model reads
        // and adapts to, not a failure that counts toward Go's tool-failure
        // breaker.
        return { status: MothershipStreamV1ToolOutcome.success, message: output.message }
      }

      await emitApprovedCall(toolCallId, toolName, executor, args, options)

      const execution = execute()
      if (!execution) {
        return { status: MothershipStreamV1ToolOutcome.success }
      }
      return execution
    }
  )
}
