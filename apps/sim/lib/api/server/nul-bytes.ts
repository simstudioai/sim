import { isPlainRecord } from '@sim/utils/object'
import { ZodError } from 'zod'

/**
 * `U+0000` is the one code point a Postgres `text`/`jsonb` value cannot carry:
 * the wire protocol terminates strings on it, so the driver throws before the
 * statement is ever planned. That throw carries no SQLSTATE the route layer can
 * classify, so it lands in `unhandledErrorResponse` and reaches the caller as
 * `500 INTERNAL_ERROR` — on pure reads (`?search=<NUL>`) just as readily as on
 * writes.
 *
 * Every other control character is rejected by nothing and stored by Postgres
 * verbatim. `\n`, `\t`, and `\r` are ordinary content in a workflow description,
 * a table cell, or a file name, so widening this to the whole C0 range would
 * break real payloads to fix nothing. Lone surrogates are also left alone: the
 * driver's UTF-8 encoder substitutes `U+FFFD` rather than throwing, so they are
 * a data-fidelity question, not an availability one. NUL is the only value in
 * this class, and it is rejected on its own.
 */
const NUL = '\u0000'

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
      if (value.includes(NUL)) return true
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) stack.push(entry)
      continue
    }
    if (isPlainRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (key.includes(NUL)) return true
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
      if (value.includes(NUL)) return path
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
        if (key.includes(NUL)) return [...path, key]
        stack.push({ value: entry, path: [...path, key] })
      }
    }
  }
  return []
}

/**
 * Rejects any `U+0000` reaching the application from a request, as a `ZodError`
 * so it renders through each surface's existing validation-error projection
 * (the v2 `{ error: { code: 'BAD_REQUEST' } }` envelope, the internal
 * `{ error, details }` body) with no per-route wiring.
 *
 * This is deliberately a *boundary* rejection rather than a shared string
 * primitive that every text field opts into. A primitive only ever protects the
 * fields somebody remembered to build on it, and it cannot protect the fields
 * that have no string schema at all — a table cell and a predicate `value` are
 * `z.unknown()` by contract, because their type is decided by the column, not
 * the wire. Those are exactly the values the reproduction found reaching the
 * driver. One scan over the already-validated payload covers every field,
 * including the ones nobody has enumerated yet.
 *
 * It runs on the *parsed* value, not the raw one, so a NUL in a property the
 * contract strips is not a spurious 400 — only values that actually flow into
 * an application use case are checked.
 *
 * Headers are not scanned: HTTP forbids NUL in a field value and the server's
 * own parser rejects it long before a contract sees it.
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
