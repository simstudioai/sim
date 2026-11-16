/**
 * Prototype-safe writes for records keyed by stored or authored data. A plain `record[key] = v`
 * with `key === '__proto__'` replaces the prototype instead of adding a key, so every write whose
 * key comes from a workflow (block keys, variable keys, subBlock ids, `data` keys, JSON members)
 * goes through {@link setOwn}.
 */

/** Sets an own enumerable property, so a `__proto__` key is data and never a prototype. */
export function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

/**
 * The own value at `key`, or `undefined`. A plain read of an absent `constructor` or `__proto__`
 * returns the inherited `Object.prototype` member, so lookups by a stored key use this.
 */
export function getOwn<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
