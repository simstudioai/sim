/**
 * Shared plumbing for the per-provider live streaming tool loops
 * (`providers/{anthropic,openai-compat,gemini,bedrock}/streaming-tool-loop.ts`).
 *
 * The wire handling in each loop is provider-specific; everything here is the
 * provider-agnostic contract they share.
 */

import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'

/**
 * Providers with a live streaming tool loop wired. Generated documentation and
 * capability reporting consume this set; providers select their own internal
 * loop from request shape. Event exposure is controlled separately.
 */
export const STREAMING_TOOL_CALL_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'anthropic',
  'azure-anthropic',
  'groq',
  'deepseek',
  'google',
  'vertex',
  'bedrock',
])

/** Aggregate result reported by a streaming tool loop when its stream closes. */
export interface StreamingToolLoopComplete {
  content: string
  tokens: { input: number; output: number; total: number }
  cost: NormalizedBlockOutput['cost']
  toolCalls?: { list: unknown[]; count: number }
  modelTime: number
  toolsTime: number
  firstResponseTime: number
  iterations: number
}

/** True for user/SDK abort errors raised when a run is cancelled mid-stream. */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError' || name === 'APIUserAbortError'
}

/** Parse provider-supplied tool arguments without accepting non-object JSON values. */
export function parseToolArguments(
  argumentsJson: string,
  toolName: string
): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch (error) {
    throw new Error(`Invalid JSON arguments for tool "${toolName}"`, { cause: error })
  }

  if (!isRecordLike(parsed)) {
    throw new Error(`Arguments for tool "${toolName}" must be a JSON object`)
  }

  return parsed
}

/**
 * Settle every open tool with a terminal status and clear the tracking map.
 * Called when a loop aborts, errors, or drains with tools still running so no
 * consumer is left with a perpetually "running" tool chip.
 */
export function settleOpenTools(
  controller: ReadableStreamDefaultController<AgentStreamEvent>,
  openTools: Map<string, string>,
  status: ToolCallEndStatus
): void {
  for (const [id, name] of openTools) {
    controller.enqueue({ type: 'tool_call_end', id, name, status })
  }
  openTools.clear()
}

interface TerminateToolLoopOptions {
  controller: ReadableStreamDefaultController<AgentStreamEvent>
  /** Tools that emitted `tool_call_start` without a matching end. */
  openTools: Map<string, string>
  /** The loop's abort controller fired — request abort or consumer cancel. */
  aborted: boolean
  /** The stream consumer called `cancel()`; the controller is already closed. */
  consumerCancelled: boolean
  error: unknown
  /** Invoked only for a genuine failure, before the stream is errored. */
  onUnexpectedError?: (error: unknown) => void
}

/**
 * Terminates a streaming tool loop that threw, settling any still-open tools.
 *
 * A consumer `cancel()` leaves the controller in the *closed* state, where
 * `enqueue` and `close` both throw `TypeError: Invalid state`. That state is
 * indistinguishable via `desiredSize` — it reports `0` when closed and `null`
 * only when errored — so loops must track the cancel explicitly and stop
 * writing. Every provider loop routes its catch block through here so the
 * five of them cannot drift.
 */
export function terminateToolLoop({
  controller,
  openTools,
  aborted,
  consumerCancelled,
  error,
  onUnexpectedError,
}: TerminateToolLoopOptions): void {
  if (consumerCancelled) {
    return
  }

  if (aborted) {
    settleOpenTools(controller, openTools, 'cancelled')
    controller.close()
    return
  }

  settleOpenTools(controller, openTools, 'error')
  onUnexpectedError?.(error)
  controller.error(toError(error))
}
