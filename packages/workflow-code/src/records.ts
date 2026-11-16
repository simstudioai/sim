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

/** Sets `target[key]`, or deletes it when `value` is `undefined`. Keys are typed, never stored data. */
export function setOrDelete<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K]
): void {
  if (value === undefined) delete target[key]
  else target[key] = value
}

/** Defined own entries; an `undefined` member means the same as an absent one. */
function definedEntries(value: object): Array<[string, unknown]> {
  return Object.entries(value).filter(([, member]) => member !== undefined)
}

/**
 * Structural equality over model values and stored JSON: key order is ignored (jsonb does not
 * keep it), an `undefined` member equals an absent one, and arrays compare in order. Total.
 */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  const leftEntries = definedEntries(left)
  const rightRecord = right as Record<string, unknown>
  if (leftEntries.length !== definedEntries(right).length) return false
  return leftEntries.every(
    ([key, member]) => Object.hasOwn(rightRecord, key) && deepEqual(member, rightRecord[key])
  )
}

/**
 * JSON text that holds an object or array, decoded; `undefined` for blank text, text that does not
 * parse, and a scalar, which callers keep as the text it is.
 */
export function parseJsonContainer(text: string): Record<string, unknown> | unknown[] | undefined {
  if (text.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown> | unknown[])
      : undefined
  } catch {
    return undefined
  }
}
