import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Refuses an identifier carrying leading or trailing whitespace.
 *
 * This exists because trimming is not a neutral convenience on an identifier
 * that was **not** trimmed before. Every BigQuery path identifier here was
 * previously interpolated as `encodeURIComponent(params.projectId)`, so a padded
 * value became `%20%20my-project%20%20`, which names no project — GCP project
 * ids match `[a-z][a-z0-9-]{5,29}` and cannot contain whitespace — and the
 * request failed cleanly. Guarding the path with `safeUrlPathSegment` trims,
 * which silently resolves that same value to the **real** `my-project`:
 *
 * ```
 * before: /bigquery/v2/projects/%20%20my-project%20%20/datasets/prod_dataset  -> 404
 * after:  /bigquery/v2/projects/my-project/datasets/prod_dataset              -> deletes it
 * ```
 *
 * On `google_bigquery_delete_dataset` and `google_bigquery_delete_table` that
 * converts a request that did nothing into one that destroys a real dataset or
 * table, irreversibly. The rule this encodes is therefore narrow and testable:
 * **this change must not turn a failing request into a succeeding one.**
 *
 * Rejection rather than trimming is not a consistency argument — that reasoning
 * averages over sites with very different blast radii and is exactly what would
 * excuse the deletion above. It stands on two facts specific to these values:
 * no legitimate BigQuery identifier contains surrounding whitespace, so nothing
 * real is refused; and the pre-existing behaviour for these particular
 * parameters was already a clean failure, so refusing preserves it while adding
 * an error that names the offending parameter instead of an opaque 404.
 *
 * Identifiers that this PR did **not** newly trim keep `safeUrlPathSegment`.
 * `datasetId` on the two delete tools, for instance, was already
 * `.trim()`-ed before this branch, so trimming it is not a change made here and
 * refusing it would break callers whose stored value works today. That is a
 * real pre-existing hazard, but it is not this change's to introduce or to
 * silently alter.
 */
function assertNoSurroundingWhitespace(value: string | number | bigint, paramName: string): void {
  if (typeof value === 'string' && value !== value.trim()) {
    throw new Error(
      `${paramName} cannot have leading or trailing whitespace (received ${JSON.stringify(value)})`
    )
  }
}

/**
 * Path-segment guard for an identifier this change newly began trimming.
 *
 * See {@link assertNoSurroundingWhitespace} for why padding is refused here
 * rather than trimmed away.
 */
export function strictBigQueryPathSegment(
  value: string | number | bigint,
  paramName: string
): string {
  assertNoSurroundingWhitespace(value, paramName)
  return safeUrlPathSegment(value, paramName)
}

/**
 * Returns the canonical, unencoded form of an identifier that appears in both
 * the request path and the request body.
 *
 * BigQuery names the same project, dataset and table twice per request — once
 * in the URL and once in `datasetReference` / `tableReference` /
 * `defaultDataset` — and the two must agree. Deriving the body's value from the
 * *path guard* rather than trimming independently is what keeps them in step:
 * a second normalization rule is a second thing to drift.
 *
 * Round-tripping through `safeUrlPathSegment` reuses that guard exactly — its
 * accepted input kinds, its trimming, and its rejection of dot segments — and
 * then undoes only the percent-encoding, which a JSON body must not carry.
 * `encodeURIComponent` and `decodeURIComponent` are exact inverses, so the
 * value is the guard's own output rather than an approximation of it.
 *
 * A bare `params.projectId.trim()` is what this replaces, and it was wrong in a
 * way the URL could not reveal: `safeUrlPathSegment` deliberately accepts a
 * finite number or a bigint, because an LLM tool call can serialize a
 * numeric-looking id as a JSON **number**. The path built fine from `123456`
 * while the body threw a bare `TypeError: params.projectId.trim is not a
 * function`, so the request died after passing its own guard.
 */
export function canonicalBigQueryId(value: string | number | bigint, paramName: string): string {
  return decodeURIComponent(safeUrlPathSegment(value, paramName))
}

/**
 * Body counterpart of {@link strictBigQueryPathSegment}, so a padded value is
 * refused identically whether the executor happens to build the URL or the body
 * first. Without it the two guards would disagree on the same parameter.
 */
export function strictCanonicalBigQueryId(
  value: string | number | bigint,
  paramName: string
): string {
  assertNoSurroundingWhitespace(value, paramName)
  return canonicalBigQueryId(value, paramName)
}
