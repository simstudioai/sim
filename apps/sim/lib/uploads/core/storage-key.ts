import { sanitizeFileName } from '@/executor/constants'

/**
 * POSIX `NAME_MAX`. It bounds one *path component*, not the whole key, and it
 * counts bytes. Local storage writes a key straight into the upload directory,
 * so a key whose last component crosses this throws `ENAMETOOLONG` out of
 * `writeFile` — an unclassifiable 500 on a name the contract already accepted.
 */
const MAX_STORAGE_KEY_SEGMENT_BYTES = 255

/** Sidecar attached to local objects promoted through the upload-session transport. */
export const LOCAL_UPLOAD_METADATA_SUFFIX = '.upload-metadata.json'

/**
 * Every suffix local storage appends to a stored object's own path component.
 *
 * The key's last component is not the only component derived from a file name.
 * Local storage writes siblings named after the object plus a fixed suffix, and
 * `NAME_MAX` bounds those siblings too — so the budget a name may spend is
 * `255 − the longest suffix`, not 255. Reserving that here is what makes the
 * reservation survive a second sidecar: adding an entry to this list shrinks
 * every key builder's budget at once, while a suffix invented at the write site
 * silently reopens the overflow this module exists to close.
 *
 * Transient artifacts are deliberately absent. The local upload provider stages
 * them under a path derived from the upload id alone, so no temporary name
 * inherits the file name's length and none needs a reservation here.
 *
 * Every entry is ASCII, so `length` is its byte count.
 */
const LOCAL_OBJECT_SIDECAR_SUFFIXES = [LOCAL_UPLOAD_METADATA_SUFFIX] as const

const MAX_SIDECAR_SUFFIX_BYTES = Math.max(
  ...LOCAL_OBJECT_SIDECAR_SUFFIXES.map((suffix) => suffix.length)
)

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
 * The defect this exists to remove: every key generator embedded the file name
 * in a component it also prefixed with a timestamp and a random uniquifier, so
 * the *effective* name limit was `255 − prefix`, not the 255 the contract
 * advertises. A 225-character name — well inside `maxLength: 255` — produced a
 * 256-byte component and a 500, while 256 characters was correctly a 400. The
 * upload-session path was worse: admission accepted the name, handed back a
 * transfer URL, and every later request against that session failed.
 *
 * Fixing it by shrinking the declared `maxLength` would make each caller's limit
 * a function of its own key prefix and would break names that already store
 * fine on S3 and GCS, which have no per-component limit. So the budget is
 * reserved here instead: the key is made independent of the name's length, the
 * declared limit stays honest, and no name a contract admits can produce a key
 * a store rejects. The name in a key is a debugging convenience — the row's
 * `originalName` is the identity — so truncating it costs nothing.
 *
 * The budget is {@link MAX_STORAGE_KEY_NAME_BYTES}, not `NAME_MAX` itself: local
 * storage stores sidecars beside the object under the object's own name, and a
 * component that fills `NAME_MAX` exactly leaves its sidecar nowhere to go.
 *
 * @param prefix Fixed leading text of the component (uniquifier, timestamp).
 *   Must itself leave room for at least one character of the name.
 * @param fileName Raw caller-supplied name; sanitized here.
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
