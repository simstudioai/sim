/**
 * Creates a deep clone of a value using the platform's structured-clone
 * algorithm. Handles Dates, Maps, Sets, ArrayBuffers, and other structured
 * types correctly. Does not clone functions or non-serializable objects.
 *
 * Replaces the common `JSON.parse(JSON.stringify(obj))` pattern, which loses
 * type information (Dates become strings, undefined values are dropped).
 */
export function deepClone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * Returns a new object with the given keys removed.
 *
 * @example
 * omit({ a: 1, b: 2, c: 3 }, ['b', 'c']) // { a: 1 }
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result
}

/**
 * Returns a shallow copy of `obj` with all `undefined`-valued keys removed.
 * Useful for building query-param or request-body objects where undefined
 * fields should not be serialized.
 *
 * Replaces the common `Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))` pattern.
 */
export function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
