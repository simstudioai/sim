/**
 * Browser fallback for Node-only builtins (e.g. `dns/promises`) that get pulled
 * into the client bundle by server-only code which never executes in the
 * browser — notably the connector registry, whose `ConnectorConfig` objects are
 * imported by client UI for metadata while their `listDocuments`/`getDocument`
 * fetch logic (which transitively imports `input-validation.server`) only ever
 * runs in server API routes.
 *
 * Wired in via `turbopack.resolveAlias` with the `browser` condition only, so
 * the real Node module is still resolved on the server and SSRF validation
 * remains fully intact. See `next.config.ts`.
 */
export default {}
