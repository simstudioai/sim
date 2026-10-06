import { types } from 'node:util'

/**
 * Unwraps a primitive wrapper the way `JSON.stringify` does: by its internal
 * slot, not its prototype, so an object that merely inherits from
 * `Number.prototype` stays an object and a wrapper with a swapped prototype is
 * still unwrapped. Number and String wrappers convert through `Number()` and
 * `String()` (running any user `valueOf`/`toString`, like ToNumber/ToString);
 * Boolean and BigInt wrappers read their stored value. Anything else is
 * returned unchanged.
 *
 * Arrays and objects whose prototype is `Object.prototype` skip the slot check:
 * they are nearly every node a walk visits, and only a wrapper whose prototype
 * was explicitly reset to `Object.prototype` could be missed.
 */
export function unboxJsonPrimitive(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  if (Object.getPrototypeOf(value) === Object.prototype || !types.isBoxedPrimitive(value)) {
    return value
  }
  if (types.isNumberObject(value)) return Number(value)
  if (types.isStringObject(value)) return String(value)
  if (types.isBooleanObject(value)) return Boolean.prototype.valueOf.call(value)
  if (types.isBigIntObject(value)) return BigInt.prototype.valueOf.call(value)
  return value
}
