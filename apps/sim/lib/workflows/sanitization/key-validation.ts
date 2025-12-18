/**
 * Checks if a key is valid (not undefined, null, empty, or literal "undefined"/"null")
 * Use this to validate BEFORE setting a dynamic key on any object.
 */
export function isValidKey(key: unknown): key is string {
  return (
    !!key && typeof key === 'string' && key !== 'undefined' && key !== 'null' && key.trim() !== ''
  )
}
