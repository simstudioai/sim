/**
 * Negotiation for public agent stream events (thinking / tool lifecycle).
 *
 * Exposure rule (locked) for public chat / simple SSE:
 *   emit thinking/tool SSE frames iff
 *     deployment.includeThinking === true
 *     AND request opts into agent-events-v1 via {@link AGENT_STREAM_PROTOCOL_HEADER}
 *
 * Canvas draft runs (execution-events) forward the same sink as live-only
 * `stream:thinking` / `stream:tool` events without the includeThinking gate;
 * the executor still disables the sink when block-output PII redaction is on.
 *
 * Legacy clients omitting the header stay text-only even when the deployment
 * has thinking enabled. Deployed chat UI always sends the header when loading
 * its own deployment.
 *
 * See docs: workflows/deployment/agent-events.
 */

export const AGENT_STREAM_PROTOCOL_HEADER = 'x-sim-stream-protocol' as const

export const AGENT_STREAM_PROTOCOL_V1 = 'agent-events-v1' as const

export type AgentStreamProtocol = typeof AGENT_STREAM_PROTOCOL_V1

/**
 * Returns true when both the deployment policy and the request protocol opt-in
 * are present. Used by simple SSE (Step 5+) before emitting thinking/tool frames.
 */
export function shouldEmitAgentStreamEvents(options: {
  includeThinking: boolean | null | undefined
  requestHeaders: Headers | { get(name: string): string | null }
}): boolean {
  if (options.includeThinking !== true) {
    return false
  }

  const raw = options.requestHeaders.get(AGENT_STREAM_PROTOCOL_HEADER)
  if (!raw) {
    return false
  }

  // Allow comma-separated values / surrounding whitespace from proxies.
  const tokens = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)

  return tokens.includes(AGENT_STREAM_PROTOCOL_V1)
}

/** True when the request asked for the agent-events protocol (ignores policy). */
export function requestOptsIntoAgentStreamProtocol(
  requestHeaders: Headers | { get(name: string): string | null }
): boolean {
  return shouldEmitAgentStreamEvents({
    includeThinking: true,
    requestHeaders,
  })
}
