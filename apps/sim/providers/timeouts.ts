/**
 * Deadline for a single non-streaming provider request, matching the OpenAI client's own
 * documented default (`node_modules/openai/client.d.ts`: `[opts.timeout=10 minutes]`).
 *
 * Without an explicit value the request inherits whatever the runtime imposes — under Bun
 * that is an undocumented ~300s idle timer, half the vendor's default and chosen by nobody.
 * Measured production failures at 295.8s and 278.9s were generations still in progress, not
 * stalled connections.
 *
 * Deliberately its own module rather than the `@/providers` barrel: that barrel is replaced
 * wholesale by `vi.mock` in 21 test files, so an export added there resolves to `undefined`
 * in all of them.
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = 600_000
