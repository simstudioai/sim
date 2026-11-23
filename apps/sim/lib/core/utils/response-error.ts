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
