import { getRequestContext } from '@sim/logger'

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
