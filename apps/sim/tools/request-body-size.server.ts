import { types } from 'node:util'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'

/**
 * Uses native JSON traversal with an incremental UTF-8 budget, stopping before
 * the complete oversized JSON string is allocated. Getters and toJSON retain
 * native invocation semantics; allocations inside those hooks are not bounded.
 */
export function stringifyRequestWithinLimit(value: unknown, maxBytes: number): string | undefined {
  let bytes = 0
  const containers = new WeakMap<object, number>()
  const charge = (size: number): void => {
    bytes += size
    assertKnownSizeWithinLimit(bytes, maxBytes, 'Request body')
  }
  const chargeString = (text: string): void => {
    charge(2)
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code === 0x22 || code === 0x5c) {
        charge(2)
      } else if (code < 0x20) {
        charge(code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6)
      } else if (code < 0x80) {
        charge(1)
      } else if (code < 0x800) {
        charge(2)
      } else if (code >= 0xd800 && code <= 0xdfff) {
        const next = text.charCodeAt(index + 1)
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          charge(4)
          index++
        } else {
          charge(6)
        }
      } else {
        charge(3)
      }
    }
  }
  const nativeJson = JSON as typeof JSON & {
    isRawJSON?: (input: unknown) => input is { rawJSON: string }
  }

  const serialized = JSON.stringify(value, function (this: object, key, input: unknown) {
    /** Native stringify unboxes these after calling the replacer. */
    let current = input
    if (types.isNumberObject(current)) current = +current
    else if (types.isStringObject(current)) current = String(current)
    else if (types.isBooleanObject(current)) current = Boolean.prototype.valueOf.call(current)
    else if (types.isBigIntObject(current)) current = BigInt.prototype.valueOf.call(current)

    const arrayItem = Array.isArray(this)
    const omitted =
      current === undefined || typeof current === 'function' || typeof current === 'symbol'
    if (omitted && !arrayItem) return current

    const entries = containers.get(this)
    if (entries !== undefined) {
      if (entries > 0) charge(1)
      if (!arrayItem) {
        chargeString(key)
        charge(1)
      }
      containers.set(this, entries + 1)
    }

    if (omitted || current === null) charge(4)
    else if (typeof current === 'string') chargeString(current)
    else if (typeof current === 'number')
      charge(Number.isFinite(current) ? String(current).length : 4)
    else if (typeof current === 'boolean') charge(current ? 4 : 5)
    else if (typeof current === 'object') {
      if (nativeJson.isRawJSON?.(current)) {
        charge(Buffer.byteLength(current.rawJSON, 'utf8'))
      } else {
        charge(2)
        containers.set(current, 0)
      }
    }
    return current
  })

  if (serialized !== undefined) {
    assertKnownSizeWithinLimit(Buffer.byteLength(serialized, 'utf8'), maxBytes, 'Request body')
  }
  return serialized
}
