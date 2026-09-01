const OBJECT_NOT_FOUND_LABELS = new Set(['NotFound', 'NoSuchKey', 'BlobNotFound'])

/**
 * A missing bucket or container is a misconfiguration, not an absent object, and
 * it also answers 404. Without this it would read as "no metadata" and every file
 * read would fail closed with no error to alert on.
 */
const CONTAINER_NOT_FOUND_LABELS = new Set(['NoSuchBucket', 'ContainerNotFound'])

function readLabels(error: unknown): string[] | null {
  if (!error || typeof error !== 'object') return null
  const { name, code } = error as { name?: unknown; code?: unknown }
  /**
   * `name` and `code` are both consulted: Azure raises a `RestError` whose `name`
   * carries the class and whose `code` carries the reason, while the AWS SDK puts
   * the reason in `name`.
   */
  return [name, code].filter((value): value is string => typeof value === 'string')
}

/**
 * True when a storage provider reports that an object does not exist.
 *
 * Call this only from code that has just performed an object-level operation, so a
 * bare 404 can be attributed to that object. A bare 404 is otherwise ambiguous —
 * GCS answers a missing object and a missing bucket identically (`code: 404`,
 * `errors[].reason: 'notFound'`), separable only by a human-readable message — and
 * every caller here is a provider client that knows exactly what it asked for.
 *
 * Absence is an expected outcome of a lookup, so callers turn it into an empty
 * result rather than propagating it.
 *
 * A network failure, a permission denial, or a provider 5xx still propagates.
 */
export function isObjectNotFoundError(error: unknown): boolean {
  const labels = readLabels(error)
  if (!labels) return false
  if (labels.some((label) => CONTAINER_NOT_FOUND_LABELS.has(label))) return false
  if (labels.some((label) => OBJECT_NOT_FOUND_LABELS.has(label))) return true

  const { code, statusCode, $metadata } = error as {
    code?: unknown
    statusCode?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  return code === 404 || statusCode === 404 || $metadata?.httpStatusCode === 404
}
