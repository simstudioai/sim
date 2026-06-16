/**
 * Minimum estimated static-prefix size (system + tool definitions) before it is
 * worth marking a prompt-cache breakpoint. This is a rough lower bound across
 * Claude models (some require more); below it, providers silently skip caching
 * anyway, so this only avoids spending a breakpoint on a trivially small prefix.
 */
const MIN_CACHEABLE_PREFIX_TOKENS = 1024

/** Rough token estimate (~4 chars/token) — fast and good enough for a gate. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Decides whether to inject prompt-cache breakpoints on the static prefix
 * (system prompt + tool definitions) for providers that require explicit cache
 * control (Anthropic, Bedrock, and Anthropic models via OpenRouter).
 *
 * Caching only pays off when the prefix is large enough to be cacheable AND is
 * actually re-read: agent tool-loops re-send the prefix on every iteration, and
 * a large system prompt is typically reused across runs within the cache TTL.
 * A small, tool-less prompt is intentionally skipped so a one-shot call never
 * pays the cache-write surcharge for a prefix that is never read back.
 */
export function shouldCacheStaticPrefix(params: {
  systemPrompt: string | null | undefined
  hasTools: boolean
  toolsApproxChars?: number
}): boolean {
  const system = params.systemPrompt ?? ''
  if (!system) {
    return false
  }

  const systemTokens = estimateTokens(system)
  const toolTokens = params.toolsApproxChars ? Math.ceil(params.toolsApproxChars / 4) : 0
  const prefixTokens = systemTokens + toolTokens

  if (prefixTokens < MIN_CACHEABLE_PREFIX_TOKENS) {
    return false
  }

  return params.hasTools || systemTokens >= MIN_CACHEABLE_PREFIX_TOKENS
}
