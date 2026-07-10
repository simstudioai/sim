/**
 * Fractional indexing — generate ordering strings that sort lexicographically.
 *
 * In-house port of David Greenspan's algorithm
 * (https://observablehq.com/@dgreensp/implementing-fractional-indexing),
 * behavior-identical to the `fractional-indexing` npm package (CC0). A key is a
 * variable-length base-62 string: between any two keys there is always room for
 * another, so inserts never renumber existing rows. The only cost is gradual
 * length growth under repeated same-spot inserts.
 *
 * A key is `<integer part><fraction>`. The integer part's first character
 * encodes its own length (`a..z` → 2..27, `A..Z` → 27..2), letting integers
 * grow without bound in both directions. The fraction is plain base-62 digits
 * with no trailing zero.
 */

// ---------------------------------------------------------------------------
// Digits
// ---------------------------------------------------------------------------

/** Default digit alphabet. Must be in ascending character-code order. */
export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

// ---------------------------------------------------------------------------
// Integer-part helpers
// ---------------------------------------------------------------------------

/** Length the integer part must have, derived from its first character. */
function getIntegerLength(head: string): number {
  if (head >= 'a' && head <= 'z') {
    return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  }
  if (head >= 'A' && head <= 'Z') {
    return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  }
  throw new Error(`invalid order key head: ${head}`)
}

function validateInteger(int: string): void {
  if (int.length !== getIntegerLength(int[0])) {
    throw new Error(`invalid integer part of order key: ${int}`)
  }
}

function getIntegerPart(key: string): string {
  const integerPartLength = getIntegerLength(key[0])
  if (integerPartLength > key.length) {
    throw new Error(`invalid order key: ${key}`)
  }
  return key.slice(0, integerPartLength)
}

function validateOrderKey(key: string, digits: string): void {
  if (key === `A${digits[0].repeat(26)}`) {
    throw new Error(`invalid order key: ${key}`)
  }
  // getIntegerPart throws if the head is bad or the key is too short.
  const i = getIntegerPart(key)
  const f = key.slice(i.length)
  if (f.slice(-1) === digits[0]) {
    throw new Error(`invalid order key: ${key}`)
  }
}

/** Increment the integer part; returns null past the largest integer. */
function incrementInteger(x: string, digits: string): string | null {
  validateInteger(x)
  const [head, ...digs] = x.split('')
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digits.indexOf(digs[i]) + 1
    if (d === digits.length) {
      digs[i] = digits[0]
    } else {
      digs[i] = digits[d]
      carry = false
    }
  }
  if (carry) {
    if (head === 'Z') {
      return `a${digits[0]}`
    }
    if (head === 'z') {
      return null
    }
    const h = String.fromCharCode(head.charCodeAt(0) + 1)
    if (h > 'a') {
      digs.push(digits[0])
    } else {
      digs.pop()
    }
    return h + digs.join('')
  }
  return head + digs.join('')
}

/** Decrement the integer part; returns null past the smallest integer. */
function decrementInteger(x: string, digits: string): string | null {
  validateInteger(x)
  const [head, ...digs] = x.split('')
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digits.indexOf(digs[i]) - 1
    if (d === -1) {
      digs[i] = digits.slice(-1)
    } else {
      digs[i] = digits[d]
      borrow = false
    }
  }
  if (borrow) {
    if (head === 'a') {
      return `Z${digits.slice(-1)}`
    }
    if (head === 'A') {
      return null
    }
    const h = String.fromCharCode(head.charCodeAt(0) - 1)
    if (h < 'Z') {
      digs.push(digits.slice(-1))
    } else {
      digs.pop()
    }
    return h + digs.join('')
  }
  return head + digs.join('')
}

// ---------------------------------------------------------------------------
// Midpoint
// ---------------------------------------------------------------------------

/**
 * Fraction strictly between `a` and `b` (both without integer parts). `a` may be
 * empty; `b` is null (open end) or non-empty and `> a`. No trailing zeros.
 */
function midpoint(a: string, b: string | null | undefined, digits: string): string {
  const zero = digits[0]
  if (b != null && a >= b) {
    throw new Error(`${a} >= ${b}`)
  }
  if (a.slice(-1) === zero || (b && b.slice(-1) === zero)) {
    throw new Error('trailing zero')
  }
  if (b) {
    // Strip the longest common prefix, padding `a` with zeros as we go. `b`
    // needs no padding — it can't end before `a` within the common prefix.
    let n = 0
    while ((a[n] || zero) === b[n]) {
      n++
    }
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits)
    }
  }
  // First digits (or lack thereof) differ.
  const digitA = a ? digits.indexOf(a[0]) : 0
  const digitB = b != null ? digits.indexOf(b[0]) : digits.length
  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB))
    return digits[midDigit]
  }
  // First digits are consecutive.
  if (b && b.length > 1) {
    return b.slice(0, 1)
  }
  // `b` is null or a single digit; recurse into `a`'s tail.
  return digits[digitA] + midpoint(a.slice(1), null, digits)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a key that sorts strictly between `a` and `b`. Either may be null for
 * an open end. `a < b` lexicographically when both are non-null.
 *
 * @throws if `a`/`b` are invalid keys or `a >= b`.
 */
export function generateKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  digits: string = BASE_62_DIGITS
): string {
  if (a != null) {
    validateOrderKey(a, digits)
  }
  if (b != null) {
    validateOrderKey(b, digits)
  }
  if (a != null && b != null && a >= b) {
    throw new Error(`${a} >= ${b}`)
  }
  if (a == null) {
    if (b == null) {
      return `a${digits[0]}`
    }
    const ib = getIntegerPart(b)
    const fb = b.slice(ib.length)
    if (ib === `A${digits[0].repeat(26)}`) {
      return ib + midpoint('', fb, digits)
    }
    if (ib < b) {
      return ib
    }
    const res = decrementInteger(ib, digits)
    if (res == null) {
      throw new Error('cannot decrement any more')
    }
    return res
  }

  if (b == null) {
    const ia = getIntegerPart(a)
    const fa = a.slice(ia.length)
    const i = incrementInteger(ia, digits)
    return i == null ? ia + midpoint(fa, null, digits) : i
  }

  const ia = getIntegerPart(a)
  const fa = a.slice(ia.length)
  const ib = getIntegerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) {
    return ia + midpoint(fa, fb, digits)
  }
  const i = incrementInteger(ia, digits)
  if (i == null) {
    throw new Error('cannot increment any more')
  }
  if (i < b) {
    return i
  }
  return ia + midpoint(fa, null, digits)
}

/**
 * Returns `n` distinct keys in sorted order, strictly between `a` and `b` (same
 * open-end semantics as {@link generateKeyBetween}). When both ends are null,
 * returns a contiguous run of "integer" keys.
 */
export function generateNKeysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  n: number,
  digits: string = BASE_62_DIGITS
): string[] {
  if (n === 0) {
    return []
  }
  if (n === 1) {
    return [generateKeyBetween(a, b, digits)]
  }
  if (b == null) {
    let c = generateKeyBetween(a, b, digits)
    const result = [c]
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b, digits)
      result.push(c)
    }
    return result
  }
  if (a == null) {
    let c = generateKeyBetween(a, b, digits)
    const result = [c]
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c, digits)
      result.push(c)
    }
    result.reverse()
    return result
  }
  const mid = Math.floor(n / 2)
  const c = generateKeyBetween(a, b, digits)
  return [
    ...generateNKeysBetween(a, c, mid, digits),
    c,
    ...generateNKeysBetween(c, b, n - mid - 1, digits),
  ]
}
