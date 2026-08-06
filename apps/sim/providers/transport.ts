/**
 * Transport policy for provider requests, in one place.
 *
 * These pin what the vendor SDKs already default to, so an SDK bump cannot silently
 * move production behaviour. For 16 of 18 providers this is a no-op. Groq and Cerebras
 * are the exception and are marked at {@link PROVIDER_HEADERS_TIMEOUT_MS}.
 *
 * What these deliberately do NOT do: bound a stalled stream. Bun's `fetch` is native
 * and appears to impose a socket-scoped idle wall of roughly 300s, reduced by however
 * long a pooled socket sat idle before reuse. That figure is observed, not documented,
 * and is not something these constants can override — raising a number above it changes
 * nothing. Only keeping bytes on the socket can rescue a long silent generation, and
 * that work belongs in the stream pump.
 */

/**
 * Time-to-headers budget for a single attempt, matching `openai@7`'s own
 * `DEFAULT_TIMEOUT`.
 *
 * Behaviour-preserving for the 16 providers already on that client. It is a deliberate
 * divergence for **Groq and Cerebras**, whose SDKs default to 60s: on a non-streaming
 * call headers do not arrive until the generation completes, so 60s caps every
 * generation at a minute and then retries it twice, re-billing. The cost of the raise is
 * that a genuinely hung call now fails slower — see the PR for the worst-case numbers.
 *
 * It must stay generous: `deepseek-reasoner`, `kimi-k3`, `grok-4.5-reasoning` and
 * every dynamic-catalog provider can legitimately generate for minutes with zero
 * bytes on the wire, and on a non-streaming call headers do not arrive until the
 * generation completes. A tighter value converts today's successes into failures.
 */
export const PROVIDER_HEADERS_TIMEOUT_MS = 600_000

/**
 * Vendor default, pinned rather than changed.
 *
 * Deliberately not lowered to 0 in favour of a hand-rolled loop: a chat completion
 * is non-idempotent and carries no idempotency key, and on the non-streaming path
 * the response only exists once the generation has already been billed — so a
 * replay re-bills completed work, multiplied by every turn of the tool loop.
 */
export const PROVIDER_MAX_RETRIES = 2

export interface OpenAICompatTransport {
  timeout: number
  maxRetries: number
}

/**
 * Transport options for the OpenAI-compatible clients.
 *
 * Stamps `timeout` and `maxRetries` only. Both are process-wide constants, which is
 * what makes them safe to set in a constructor that {@link getCachedProviderClient}
 * memoises — anything varying per request must be passed per call instead.
 *
 * Deliberately stamps no `fetch`: a wrapper would turn the SDK's header-only timer
 * into a total deadline that truncates a live stream, and would drop the caller's
 * abort signal.
 */
export const openAICompatTransport = (): OpenAICompatTransport => ({
  timeout: PROVIDER_HEADERS_TIMEOUT_MS,
  maxRetries: PROVIDER_MAX_RETRIES,
})
