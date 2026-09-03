/**
 * Requests the server makes to itself.
 *
 * The embedded CLI and the agent-cli engines dispatch to the v2 route handlers
 * in-process (see `in-process-transport.ts`). Those requests are marked here so
 * admission can skip the abuse controls that exist for callers arriving over the
 * network: the pre-auth IP bucket and the per-key rate limits. Authentication is
 * not skipped — an internal request still carries the caller's key and resolves
 * to the same principal the network path would.
 *
 * A WeakSet keyed by the Request object, not a header: any client on the wire
 * can set a header; nothing outside this process can reach the set.
 */
const INTERNAL_REQUESTS = new WeakSet<Request>()

export function markInternalRequest(request: Request): void {
  INTERNAL_REQUESTS.add(request)
}

export function isInternalRequest(request: Request): boolean {
  return INTERNAL_REQUESTS.has(request)
}
