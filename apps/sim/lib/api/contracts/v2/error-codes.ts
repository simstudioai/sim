/**
 * The closed set of `error.code` values the public v2 API emits, and the HTTP status each
 * one is sent with.
 *
 * Lives in the contract layer rather than beside the response helpers because two consumers
 * need it and they must not drift: the runtime (`app/api/v2/lib/response.ts`, which renders
 * the envelope) and the published OpenAPI documents (`contracts/v2/openapi/shared.ts`, which
 * document one example per status). Documenting a code the runtime cannot emit — or a status
 * paired with the wrong code — is how the reference stops describing the API.
 */

export type V2ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'LOCKED'
  | 'RATE_LIMITED'
  | 'CLIENT_CLOSED_REQUEST'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'

/**
 * The status each code is sent with. `Record<V2ErrorCode, number>` is the completeness gate:
 * adding a code fails to compile until it declares its status.
 */
export const V2_ERROR_STATUS_BY_CODE: Record<V2ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  USAGE_LIMIT_EXCEEDED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  LOCKED: 423,
  RATE_LIMITED: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
}

/**
 * The inverse map.
 *
 * The pairing is one-to-one, which is what lets a documented error response derive its code
 * from the status it is declared under instead of restating it. That property is load-bearing
 * for the API reference, so it is asserted in `error-codes.test.ts` rather than trusted — a
 * second code claiming a status would silently drop an entry here and make one documented
 * example name the wrong code.
 *
 * This describes how a code chooses its status, not every status the surface can send. A
 * route may pass an explicit status alongside a code — `POST /workflows/{id}/execute` answers
 * `408` with `BAD_REQUEST` — so a status absent from this map is one no documented error
 * response may claim, which is what the OpenAPI layer enforces.
 */
export const V2_ERROR_CODE_BY_STATUS: Partial<Record<number, V2ErrorCode>> = Object.fromEntries(
  Object.entries(V2_ERROR_STATUS_BY_CODE).map(([code, status]) => [status, code as V2ErrorCode])
)
