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
 * True when a provider names the missing resource as the object itself.
 *
 * The strict form. Use it wherever the caller cannot vouch for what was requested,
 * because an unlabelled 404 is ambiguous: GCS answers a missing object and a
 * missing bucket identically (`code: 404`, `errors[].reason: 'notFound'`), so only
 * the human-readable message separates them. Treating that as absence would let a
 * bucket misconfiguration read as "no metadata" and fail every read closed with
 * nothing left to alert on, so it stays an error here.
 */
export function hasObjectNotFoundLabel(error: unknown): boolean {
  const labels = readLabels(error)
  if (!labels) return false
  if (labels.some((label) => CONTAINER_NOT_FOUND_LABELS.has(label))) return false
  return labels.some((label) => OBJECT_NOT_FOUND_LABELS.has(label))
}

/**
 * True when a storage provider reports that an object does not exist.
 *
 * The lenient form, for a caller that has just performed an object-level operation
 * and can therefore attribute a bare 404 to that object — which is what every
 * provider client here does, and how each spelled this check before it was shared.
 * It additionally accepts a bare 404 (`code`, `statusCode`, or
 * `$metadata.httpStatusCode`), which GCS relies on since it carries no label.
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
