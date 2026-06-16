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

/**
 * Returns true only for object-map values, excluding arrays and null.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Returns true for any non-null, non-array object — the LOOSE record check.
 * Unlike {@link isPlainRecord}, this does NOT inspect the prototype, so it also
 * accepts class instances, Date, Map, etc. Use this when you only need to know a
 * value is an indexable object (e.g. before spreading or Object.entries), and
 * reach for isPlainRecord when you must exclude exotic objects.
 */
export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively sorts the keys of every plain object reachable from {@link value},
 * preserving array order while recursing into array elements. Primitives and
 * `null` are returned unchanged. Produces a structurally equivalent value with
 * deterministic key ordering, suitable for stable comparison or serialization.
 *
 * @remarks Only string keys are sorted and retained; symbol keys are dropped,
 * matching the stable-serialization callers this serves.
 */
export function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.keys(obj)
      .sort()
      .reduce((result: Record<string, unknown>, key: string) => {
        result[key] = sortObjectKeysDeep(obj[key])
        return result
      }, {})
  }
  return value
}
