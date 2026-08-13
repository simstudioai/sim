import { isPlainRecord } from '@sim/utils/object'
import { containsNulCharacter } from '@sim/utils/string'
import { ZodError } from 'zod'

/**
 * Cheap existence scan used on every request. Descends only into arrays and
 * plain records, so a `Buffer`, `Uint8Array`, or `Date` in a parsed payload is
 * treated as a leaf — a zero *byte* in binary content is legitimate and must
 * not be confused with a NUL *character* in text.
 */
function containsNulByte(root: unknown): boolean {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') {
      if (containsNulCharacter(value)) return true
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) stack.push(entry)
      continue
    }
    if (isPlainRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (containsNulCharacter(key)) return true
        stack.push(entry)
      }
    }
  }
  return false
}

/**
 * Second pass, run only once a NUL is known to be present, so the common case
 * never pays for path bookkeeping. Returns the path of the first offending
 * string, matching the shape Zod reports for a failed field.
 */
function findNulBytePath(root: unknown): PropertyKey[] {
  const stack: { value: unknown; path: PropertyKey[] }[] = [{ value: root, path: [] }]
  while (stack.length > 0) {
    const frame = stack.pop()
    if (!frame) break
    const { value, path } = frame
    if (typeof value === 'string') {
      if (containsNulCharacter(value)) return path
      continue
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: [...path, index] })
      }
      continue
    }
    if (isPlainRecord(value)) {
      const entries = Object.entries(value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, entry] = entries[index]
        if (containsNulCharacter(key)) return [...path, key]
        stack.push({ value: entry, path: [...path, key] })
      }
    }
  }
  return []
}

/**
 * Rejects any `U+0000` reaching the application from a request — see
 * {@link containsNulCharacter} for why Postgres cannot carry one — as a
 * `ZodError`, so it renders through each surface's existing validation-error
 * projection with no per-route wiring.
 *
 * A boundary scan rather than a shared string schema, because the values that
 * reached the driver have no string schema to opt into: a table cell and a
 * predicate `value` are `z.unknown()` by contract, their type decided by the
 * column rather than the wire.
 *
 * It runs on the *parsed* value, so a NUL in a property the contract strips is
 * not a spurious 400. Headers are not scanned: HTTP forbids NUL in a field
 * value and the server's own parser rejects it first.
 */
export function nulByteValidationError(value: unknown): ZodError | null {
  if (!containsNulByte(value)) return null
  return new ZodError([
    {
      code: 'custom',
      path: findNulBytePath(value),
      message: 'Value cannot contain a NUL character (U+0000)',
      input: undefined,
    },
  ])
}
