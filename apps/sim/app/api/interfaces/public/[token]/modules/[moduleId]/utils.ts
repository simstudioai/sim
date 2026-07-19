import { NextResponse } from 'next/server'

/**
 * Shared response primitives for the token-scoped public interface data routes.
 *
 * These are deliberately uniform: every route in this subtree fails the same
 * way, so the difference between "unknown token", "module not in this layout",
 * and "the referenced table was deleted" is not observable from outside.
 */

/**
 * A shared interface can be un-shared, re-pointed, or archived at any moment,
 * so a fixed token URL must never serve anything a cache could replay. Matches
 * the public file share's content headers.
 */
export const PUBLIC_INTERFACE_CACHE_CONTROL = 'private, no-cache, must-revalidate'

/**
 * The single 404 every public interface data route returns.
 *
 * Unknown token, inactive share, archived interface, missing module,
 * unconfigured module, and a resource that no longer resolves inside the
 * interface's own workspace are all indistinguishable from outside — the body
 * carries no identifier and no reason, so existence is never leaked.
 */
export function publicInterfaceNotFound(): NextResponse {
  return NextResponse.json(
    { error: 'Not found' },
    { status: 404, headers: { 'Cache-Control': PUBLIC_INTERFACE_CACHE_CONTROL } }
  )
}

/** JSON body for a public interface read, never cached. */
export function publicInterfaceJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': PUBLIC_INTERFACE_CACHE_CONTROL },
  })
}

/**
 * The only two failure messages an anonymous visitor ever sees from a run.
 *
 * `preprocessExecution` reports precisely why a run was refused — undeployed
 * workflow, plan rate limit, exhausted usage allowance, banned account — and
 * `executeWorkflow` surfaces whatever the failing block said. All of that is
 * internal workspace state, and both public clients render the `error` string
 * they receive, so the reason is logged and a neutral message goes out with the
 * real status code preserved.
 */
const RUN_THROTTLED_MESSAGE = 'Too many requests. Please try again later.'
const RUN_UNAVAILABLE_MESSAGE = 'This interface is currently unavailable. Please try again later.'

export function publicRunFailure(statusCode: number): NextResponse {
  return publicInterfaceJson(
    { error: statusCode === 429 ? RUN_THROTTLED_MESSAGE : RUN_UNAVAILABLE_MESSAGE },
    statusCode
  )
}
