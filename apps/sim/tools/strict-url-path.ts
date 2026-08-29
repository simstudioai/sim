import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Guards a path identifier that this change **newly began trimming**, refusing
 * surrounding whitespace instead of silently removing it.
 *
 * Trimming is not a neutral convenience when it is new. These identifiers were
 * previously interpolated raw or through a bare `encodeURIComponent`, so a
 * padded value was percent-encoded and named nothing:
 *
 * ```
 * before: /2.0/sign_requests/%20%20<uuid>%20%20/cancel                       -> 404, no-op
 * after:  /2.0/sign_requests/<uuid>/cancel                                   -> cancels it
 *
 * before: /bigquery/v2/projects/%20%20my-project%20%20/datasets/prod_dataset -> 404, no-op
 * after:  /bigquery/v2/projects/my-project/datasets/prod_dataset             -> deletes it
 * ```
 *
 * On `box_sign_cancel_request` and `google_bigquery_delete_*` that converts a
 * request which did nothing into one with an **irreversible** effect, driven by
 * a value the caller never wrote. The rule this encodes is therefore narrow and
 * testable: *guarding a path must not turn a failing request into a succeeding
 * one.*
 *
 * Rejection is deliberately **not** argued from consistency with the other
 * guarded sites. That reasoning averages over parameters with very different
 * blast radii and would excuse the deletion above. It rests on two facts
 * specific to these values:
 *
 * 1. None of them can legitimately carry surrounding whitespace — a Box Sign id
 *    is a UUID, a GCP project id matches `[a-z][a-z0-9-]{5,29}` — so refusing
 *    excludes nothing a caller could really mean.
 * 2. Their previous behaviour was already a clean failure, so refusing
 *    preserves it, and improves on it by replacing an opaque provider 404 with
 *    an error naming the parameter.
 *
 * Identifiers that were **already** trimmed before this change keep plain
 * {@link safeUrlPathSegment}: trimming those is not a change made here, and
 * refusing them would break callers whose stored value works today.
 */
export function strictUrlPathSegment(value: string | number | bigint, paramName: string): string {
  assertNoSurroundingWhitespace(value, paramName)
  return safeUrlPathSegment(value, paramName)
}

/**
 * Shared precondition behind {@link strictUrlPathSegment} and its body-value
 * counterparts, so a padded value is refused identically wherever the same
 * identifier is rendered.
 */
export function assertNoSurroundingWhitespace(
  value: string | number | bigint,
  paramName: string
): void {
  if (typeof value === 'string' && value !== value.trim()) {
    /**
     * The rejected value is deliberately **not** echoed. These parameters are
     * `visibility: 'user-or-llm'`, and this message travels back as a tool
     * result the model reads, so quoting the input would copy attacker-chosen
     * text — including U+2028/U+2029, which terminate a line for some parsers —
     * straight into the model's context. Naming the parameter is the actionable
     * part; the caller already knows what it sent.
     */
    throw new Error(`${paramName} cannot have leading or trailing whitespace`)
  }
}
