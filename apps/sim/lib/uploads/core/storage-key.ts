import { sanitizeFileName } from '@/executor/constants'

/** POSIX `NAME_MAX`: bytes in one *path component*, not in the whole key. */
const MAX_STORAGE_KEY_SEGMENT_BYTES = 255

/** Sidecar attached to local objects promoted through the upload-session transport. */
export const LOCAL_UPLOAD_METADATA_SUFFIX = '.upload-metadata.json'

/**
 * Roots the local data plane owns inside the upload directory.
 *
 * Both hold work-in-progress rather than stored objects, so both are swept by
 * the local cleanup job. They live beside the other local-artifact names rather
 * than in the data-plane provider so the sweep can name what it reclaims
 * without importing the transport that writes it; a root known only to its
 * writer accumulates forever.
 */
export const LOCAL_MULTIPART_ROOT = '.multipart'
export const LOCAL_STAGING_ROOT = '.staging'

/**
 * Every suffix local storage appends to a stored object's own path component.
 *
 * `NAME_MAX` bounds those siblings too, so adding an entry here shrinks every
 * key builder's budget at once — while a suffix invented at the write site
 * silently reopens the overflow this module exists to close. Transient staging
 * artifacts need no entry: they are named from the upload id alone.
 *
 * Every entry is ASCII, so `length` is its byte count.
 */
const MAX_SIDECAR_SUFFIX_BYTES = LOCAL_UPLOAD_METADATA_SUFFIX.length

/**
 * Bytes a key's last component may occupy, sidecars accounted for.
 *
 * Exported so a store-shaped test can assert the invariant end to end rather
 * than restate the arithmetic.
 */
export const MAX_STORAGE_KEY_NAME_BYTES = MAX_STORAGE_KEY_SEGMENT_BYTES - MAX_SIDECAR_SUFFIX_BYTES

/**
 * Longest trailing `.ext` worth preserving through a truncation. Beyond this
 * the dot is part of the name, not a type marker, and keeping it would eat the
 * whole budget.
 */
const MAX_PRESERVED_EXTENSION_LENGTH = 16

/**
 * Fits a sanitized name into `budget` characters, keeping its extension so a
 * truncated key still reads as the same kind of file.
 *
 * `sanitizeFileName` maps every character outside `[A-Za-z0-9.-]` to `_`, so its
 * output is pure ASCII and one character is one byte. That is what lets this
 * measure the budget with `length` instead of re-encoding.
 */
function fitStorageKeyName(safeName: string, budget: number): string {
  if (safeName.length <= budget) return safeName

  const dotIndex = safeName.lastIndexOf('.')
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : ''
  if (extension.length === 0 || extension.length > MAX_PRESERVED_EXTENSION_LENGTH) {
    return safeName.slice(0, budget)
  }
  if (extension.length >= budget) return safeName.slice(0, budget)
  return safeName.slice(0, budget - extension.length) + extension
}

/**
 * Builds the last component of a storage key from a caller-supplied file name.
 *
 * A name shares its path component with a uniquifier prefix, so the *effective*
 * limit is `NAME_MAX − prefix` rather than the 255 the file contracts
 * advertise. Local storage writes the key straight into the upload directory,
 * so a component past that throws `ENAMETOOLONG` out of `writeFile` — an
 * unclassifiable 500 on a name the contract already accepted, and on the
 * upload-session path a session whose every later request fails.
 *
 * Reserving the budget here rather than shrinking the declared `maxLength`
 * keeps each caller's limit off its own key prefix and keeps working the names
 * that store fine on S3 and GCS, which have no per-component limit. The name in
 * a key is a debugging convenience — the row's `originalName` is the identity —
 * so truncating it costs nothing.
 *
 * The budget is {@link MAX_STORAGE_KEY_NAME_BYTES}, not `NAME_MAX` itself: a
 * component that fills `NAME_MAX` exactly leaves its sidecar nowhere to go.
 *
 * @param prefix Must itself leave room for at least one character of the name.
 */
export function buildStorageKeySegment(prefix: string, fileName: string): string {
  const budget = MAX_STORAGE_KEY_NAME_BYTES - prefix.length
  if (budget < 1) {
    throw new Error(
      `Storage key prefix of ${prefix.length} bytes leaves no room for a file name within ${MAX_STORAGE_KEY_NAME_BYTES} bytes`
    )
  }
  return `${prefix}${fitStorageKeyName(sanitizeFileName(fileName), budget)}`
}
