import { getRequestContext } from '@sim/logger'
import { NextResponse } from 'next/server'

/**
 * Stamps the ambient request id onto an internal error body.
 *
 * `withRouteHandler` runs every handler inside a `runWithRequestContext` scope
 * and already emits the same id as the `x-request-id` header. Carrying it in
 * the body as well is what lets a user paste an error straight from the UI and
 * have it correlate to a log line — a header is not visible at that point.
 *
 * Returns the body untouched when it is not a plain object (so array and
 * scalar error bodies are preserved), when a `requestId` is already present,
 * or when there is no active request scope — the last case keeps the field out
 * of unit tests, where `getRequestContext` is mocked to `undefined`.
 */
export function withRequestId(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  if ('requestId' in body) return body

  const requestId = getRequestContext()?.requestId
  if (!requestId) return body

  return { ...body, requestId }
}

/**
 * Rebuilds an already-constructed JSON error response with the ambient request
 * id stamped into its body.
 *
 * Request parsing failures arrive as a finished `NextResponse` from the shared
 * validation helpers, which v1 and v2 routes also use and whose envelopes must
 * not change. Stamping here — at the internal builders' call site rather than
 * inside those helpers — keeps the added field scoped to internal routes.
 *
 * Returns the original response when there is no active request scope, when the
 * body is not JSON, or when it cannot be re-read. The body is read from a clone
 * so the original stays usable on any of those paths.
 */
export async function responseWithRequestId(
  response: NextResponse<unknown>
): Promise<NextResponse<unknown>> {
  if (!getRequestContext()?.requestId) return response
  if (!response.headers.get('content-type')?.includes('application/json')) return response

  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }

  const stamped = withRequestId(body)
  if (stamped === body) return response

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return NextResponse.json(stamped, { status: response.status, headers })
}
