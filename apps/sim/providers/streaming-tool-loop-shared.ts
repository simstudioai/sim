/**
 * Shared plumbing for the per-provider live streaming tool loops
 * (`providers/{anthropic,openai-compat,gemini,bedrock}/streaming-tool-loop.ts`).
 *
 * The wire handling in each loop is provider-specific; everything here is the
 * provider-agnostic contract they share.
 */

import { APIUserAbortError as AnthropicUserAbortError } from '@anthropic-ai/sdk/error'
import { findCause, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { APIUserAbortError as GroqUserAbortError } from 'groq-sdk/error'
import { APIUserAbortError as OpenAIUserAbortError } from 'openai/error'
import { classifyFailure } from '@/lib/core/errors/failure-log'
import { isTimeoutAbortReason } from '@/lib/core/execution-limits/types'
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
  'kie',
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

/**
 * True for the error a cancelled request rejects with: a platform `AbortError`, or the
 * `APIUserAbortError` the vendor SDKs raise in its place. The SDK class leaves `name` as
 * `'Error'`, so it is recognised by class, never by name.
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AnthropicUserAbortError ||
    error instanceof OpenAIUserAbortError ||
    error instanceof GroqUserAbortError ||
    (isRecordLike(error) && error.name === 'AbortError')
  )
}

/**
 * True when `error` is the run's own abort surfacing: the run's signal fired, and the failure
 * is its reason or an abort error anywhere in the cause chain. The signal decides; an abort
 * error while the run is still live is a request-level deadline, a real failure.
 */
export function isRunAbortError(error: unknown, abortSignal: AbortSignal | undefined): boolean {
  if (!abortSignal?.aborted) return false
  return (
    error === abortSignal.reason ||
    findCause(error, (link): link is Error => isAbortError(link)) !== undefined
  )
}

/**
 * The severity a provider logs its own request failure at, on the `failure-log` scale: a run
 * the user stopped or a failure {@link classifyFailure} attributes to the user is routine
 * (info), one the run's time limit cut off is expected but worth seeing (warn), and anything
 * else is an unattributed failure (error).
 */
export function providerFailureLogLevel(
  error: unknown,
  abortSignal: AbortSignal | undefined
): 'info' | 'warn' | 'error' {
  if (isRunAbortError(error, abortSignal)) {
    return isTimeoutAbortReason(abortSignal?.reason) ? 'warn' : 'info'
  }
  return classifyFailure(error) === 'user' ? 'info' : 'error'
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
  /** Invoked only for a genuine failure, before the stream is errored, at its log severity. */
  onUnexpectedError?: (error: unknown, level: 'info' | 'warn' | 'error') => void
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
  onUnexpectedError?.(error, providerFailureLogLevel(error, undefined))
  controller.error(toError(error))
}
