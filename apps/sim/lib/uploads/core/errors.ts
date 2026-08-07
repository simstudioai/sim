const OBJECT_NOT_FOUND_LABELS = new Set(['NotFound', 'NoSuchKey', 'BlobNotFound'])

/**
 * A missing bucket or container is a misconfiguration, not an absent object, and
 * it also answers 404. Without this it would read as "no metadata" and every file
 * read would fail closed with no error to alert on.
 */
const CONTAINER_NOT_FOUND_LABELS = new Set(['NoSuchBucket', 'ContainerNotFound'])

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

  const { name, code, statusCode, $metadata } = error as {
    name?: unknown
    code?: unknown
    statusCode?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }

  /**
   * `name` and `code` are both consulted: Azure raises a `RestError` whose `name`
   * carries the class and whose `code` carries the reason, while the AWS SDK puts
   * the reason in `name`.
   */
  const labels = [name, code].filter((value): value is string => typeof value === 'string')

  if (labels.some((label) => CONTAINER_NOT_FOUND_LABELS.has(label))) return false
  if (labels.some((label) => OBJECT_NOT_FOUND_LABELS.has(label))) return true

  return code === 404 || statusCode === 404 || $metadata?.httpStatusCode === 404
}
