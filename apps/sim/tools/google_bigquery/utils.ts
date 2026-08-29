import { safeUrlPathSegment, strictUrlPathSegment } from '@/tools/url-path'

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
  return decodeURIComponent(strictUrlPathSegment(value, paramName))
}

/**
 * Path-segment guard for a BigQuery identifier this change newly began
 * trimming. See `strictUrlPathSegment` for why padding is refused.
 */
export const strictBigQueryPathSegment = strictUrlPathSegment
