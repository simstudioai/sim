import { types } from 'node:util'

/**
 * Unwraps a primitive wrapper the way `JSON.stringify` does: by its internal
 * slot, not its prototype, so an object that merely inherits from
 * `Number.prototype` stays an object and a wrapper with a replaced prototype is
 * still unwrapped. Number and String wrappers convert through ToNumber and
 * ToString (unary `+` and a template literal, which run any user
 * `valueOf`/`toString` and throw where JSON would, e.g. on a BigInt or Symbol
 * result); Boolean and BigInt wrappers read their stored value. The slot check
 * runs no Proxy traps. Anything else is returned unchanged.
 */
export function unboxJsonPrimitive(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !types.isBoxedPrimitive(value)) {
    return value
  }
  if (types.isNumberObject(value)) return +value
  if (types.isStringObject(value)) return `${value}`
  if (types.isBooleanObject(value)) return Boolean.prototype.valueOf.call(value)
  if (types.isBigIntObject(value)) return BigInt.prototype.valueOf.call(value)
  return value
}
