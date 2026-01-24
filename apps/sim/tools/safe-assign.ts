const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Checks if a key is safe to use in object assignment (not a prototype pollution vector)
 */
export function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key)
}

/**
 * Safely assigns properties from source to target, filtering out prototype pollution keys.
 * Use this instead of Object.assign() when the source may contain user-controlled data.
 */
export function safeAssign<T extends object>(target: T, source: Record<string, unknown>): T {
  if (!source || typeof source !== 'object') {
    return target
  }

  for (const key of Object.keys(source)) {
    if (isSafeKey(key)) {
      ;(target as Record<string, unknown>)[key] = source[key]
    }
  }
  return target
}
