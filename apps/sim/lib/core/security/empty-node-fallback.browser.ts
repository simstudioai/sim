/**
 * Browser fallback for Node-only networking builtins (`dns`/`dns/promises`,
 * `net`, `tls`) that have no browser shim. Server-only code — notably the tool
 * and provider registries' SSRF-pinned fetch logic, which transitively imports
 * `input-validation.server` (and through it `undici`) — is statically reachable
 * from the client bundle via the workflow editor, but never executes there.
 *
 * Wired in via `turbopack.resolveAlias` with the `browser` condition only, so the
 * real Node modules are still resolved on the server and SSRF validation / IP
 * pinning remain fully intact. See `next.config.ts`.
 */
export default {}
