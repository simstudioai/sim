/**
 * Shared plumbing for the per-provider live streaming tool loops
 * (`providers/{anthropic,openai-compat,gemini,bedrock}/streaming-tool-loop.ts`).
 *
 * The wire handling in each loop is provider-specific; everything here is the
 * provider-agnostic contract they share.
 */

import type { NormalizedBlockOutput } from '@/executor/types'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'

/**
 * Providers with a live streaming tool loop wired. The executor consults this
 * (instead of hardcoding provider ids) when deciding whether an agent-events
 * run can stream tool lifecycle; providers not listed simply ignore
 * `streamToolCalls` and keep their legacy loop.
 */
export const STREAMING_TOOL_CALL_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'azure-anthropic',
  'groq',
  'deepseek',
  'google',
  'vertex',
  'bedrock',
])

/** Whether a provider has a live streaming tool loop wired. */
export function supportsStreamingToolCalls(providerId: string): boolean {
  return STREAMING_TOOL_CALL_PROVIDERS.has(providerId)
}

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
