/**
 * The one hashing primitive for `canonicalHash`, `canonicalDigests` and `sourceFingerprint`, so
 * every engine hashes identical bytes. Pure JS: the boundary rule bans `node:crypto` here, and
 * `crypto.subtle` is async.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { compareStrings } from '@sim/utils/string'

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Cannot hash non-finite number ${value}`)
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new TypeError(`Cannot hash a value of type ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError('Cannot hash a cyclic value')
  ancestors.add(value)
  let text: string
  if (Array.isArray(value)) {
    const items: string[] = []
    // Indexed, not `map`: `map` skips a hole, which would hash `[,]` as `[]`.
    for (let index = 0; index < value.length; index++) {
      const item: unknown = value[index]
      if (item === undefined) throw new TypeError('Cannot hash undefined inside an array')
      items.push(serialize(item, ancestors))
    }
    text = `[${items.join(',')}]`
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Cannot hash a non-plain object')
    }
    const entries: Array<[string, unknown]> = Object.entries(value)
    entries.sort(([a], [b]) => compareStrings(a, b))
    const fields: string[] = []
    for (const [key, field] of entries) {
      if (field !== undefined) fields.push(`${JSON.stringify(key)}:${serialize(field, ancestors)}`)
    }
    text = `{${fields.join(',')}}`
  }
  ancestors.delete(value)
  return text
}

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit (`compareStrings`), array order kept,
 * `undefined` object fields dropped, no whitespace. Key order of the input never changes the
 * output, which matters because jsonb does not keep it. Throws `TypeError` on anything JSON
 * cannot represent exactly (NaN, ±Infinity, `undefined` or holes in arrays, functions, bigint,
 * class instances) and on cycles. `JSON.stringify` escapes lone surrogates, so the output
 * is well-formed and distinct strings never collide after UTF-8 encoding.
 */
export function stableStringify(value: unknown): string {
  return serialize(value, new Set())
}

/** Lowercase hex SHA-256 of `text` encoded as UTF-8. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}
