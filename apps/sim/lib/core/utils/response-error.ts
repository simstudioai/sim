import type { z } from 'zod'

/**
 * The machine-readable part of an error response, kept beside the response so
 * the route handler's closing log line can be grouped by why a request was
 * refused without reading the body. Never the message, which can quote user
 * input.
 */
export interface ResponseErrorSummary {
  /** The stable error code the body carries, e.g. `BAD_REQUEST`. */
  errorCode: string
  /** For a validation failure, the request slice and its declared top-level field, e.g. `body.mapping`. */
  errorField?: string
  /** The cause the refusal named (`READ_ONLY_API_KEY`) or the validation issue kind (`invalid_type`). */
  errorReason?: string
  /** A short, bounded header value the reason turns on, e.g. the protocol version a client asked for. */
  errorDetail?: string
}

/**
 * Keyed by the response object, so only a response a route actually returns is
 * ever read back. One built only to extract its message is never logged.
 */
const summaries = new WeakMap<Response, ResponseErrorSummary>()

/** Records what `response` tells its caller; a later call for the same response replaces it. */
export function describeResponseError(response: Response, summary: ResponseErrorSummary): void {
  summaries.set(response, summary)
}

/** What `describeResponseError` recorded for `response`, if anything. */
export function readResponseError(response: Response): ResponseErrorSummary | undefined {
  return summaries.get(response)
}

/**
 * Records a contract validation failure: the request slice, its top-level field
 * (deeper segments can be record keys the caller wrote) unless `sliceOnly` says
 * the slice accepts caller-chosen keys, and the first issue's kind.
 */
export function describeValidationError(
  response: Response,
  error: z.ZodError,
  slice?: string,
  { sliceOnly = false }: { sliceOnly?: boolean } = {}
): void {
  const issue = error.issues[0]
  const field = [slice, sliceOnly ? undefined : issue?.path[0]]
    .filter((part) => part !== undefined && part !== '')
    .map(String)
    .join('.')
  describeResponseError(response, {
    errorCode: 'BAD_REQUEST',
    ...(field ? { errorField: field } : {}),
    ...(issue ? { errorReason: issue.code } : {}),
  })
}
