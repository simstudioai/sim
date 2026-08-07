/**
 * True when a storage provider reports that an object simply does not exist.
 *
 * Absence is an expected outcome of a lookup, not a failure, so callers turn this
 * into an empty result rather than propagating it. Every provider spells it
 * differently — S3 throws `NotFound` (HeadObject) or `NoSuchKey` (GetObject),
 * Azure Blob throws `BlobNotFound`, and GCS throws a numeric `code: 404` — and the
 * status may arrive as `$metadata.httpStatusCode`, `statusCode`, or `code`.
 *
 * Only genuine absence matches. A network failure, a permission denial, or a
 * provider 5xx still propagates so it surfaces as the error it is.
 */
export function isObjectNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as {
    name?: unknown
    code?: unknown
    statusCode?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }

  const label = typeof candidate.name === 'string' ? candidate.name : candidate.code
  if (label === 'NotFound' || label === 'NoSuchKey' || label === 'BlobNotFound') return true

  return (
    candidate.code === 404 ||
    candidate.statusCode === 404 ||
    candidate.$metadata?.httpStatusCode === 404
  )
}
