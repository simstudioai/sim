/**
 * @vitest-environment node
 *
 * Differential test: runs the in-house port side by side with the upstream
 * `fractional-indexing` package over exhaustive + randomized inputs and asserts
 * byte-identical output. The package is kept as a devDependency solely as this
 * oracle. Delete this file (and the dep) once we no longer want the comparison.
 */
import {
  generateKeyBetween as oracleKeyBetween,
  generateNKeysBetween as oracleNKeysBetween,
} from 'fractional-indexing'
import { describe, expect, it } from 'vitest'
import {
  generateKeyBetween,
  generateNKeysBetween,
} from '@/lib/fractional-indexing/fractional-indexing'

/** Deterministic LCG (Numerical Recipes constants) — no test-only dependency. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive)
}

/** Length of a key's integer part from its head char (a..z → 2..27, A..Z → 27..2). */
function integerPartLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  throw new Error(`unexpected head: ${head}`)
}

/** Compare both impls for `(a, b)`: same return value, or both throw. */
function expectKeyParity(a: string | null, b: string | null): string | null {
  let mine: string | undefined
  let mineThrew = false
  try {
    mine = generateKeyBetween(a, b)
  } catch {
    mineThrew = true
  }

  let theirs: string | undefined
  let theirsThrew = false
  try {
    theirs = oracleKeyBetween(a, b)
  } catch {
    theirsThrew = true
  }

  expect(mineThrew).toBe(theirsThrew)
  if (!mineThrew) {
    expect(mine).toBe(theirs)
    return mine as string
  }
  return null
}

describe('fractional-indexing in-house port ≡ upstream', () => {
  it('matches known anchor values from the algorithm', () => {
    expect(generateKeyBetween(null, null)).toBe('a0')
    expect(generateKeyBetween('a0', null)).toBe('a1')
    expect(generateKeyBetween(null, 'a0')).toBe('Zz')
    expect(generateKeyBetween('a0', 'a1')).toBe('a0V')
    // All match the oracle too.
    expect(generateKeyBetween(null, null)).toBe(oracleKeyBetween(null, null))
    expect(generateKeyBetween('a0', 'a1')).toBe(oracleKeyBetween('a0', 'a1'))
  })

  it('matches over exhaustive ordered pairs from a fixed key pool', () => {
    // Build a sorted pool by chaining appends, then test every ordered pair
    // plus both open ends.
    const pool: string[] = []
    let last: string | null = null
    for (let i = 0; i < 40; i++) {
      last = generateKeyBetween(last, null)
      pool.push(last)
    }
    const ends: Array<string | null> = [null, ...pool]
    for (const a of ends) {
      for (const b of ends) {
        // Only feed ordered, distinct bounds to the "happy path"; the parity
        // helper also asserts both throw together for the invalid ones.
        expectKeyParity(a, b)
      }
    }
  })

  it('matches while building a list via random-position inserts', () => {
    for (const seed of [1, 7, 42, 1337, 99999]) {
      const rng = makeRng(seed)
      const keys: string[] = []
      for (let step = 0; step < 400; step++) {
        const pos = randInt(rng, keys.length + 1)
        const a = pos === 0 ? null : keys[pos - 1]
        const b = pos === keys.length ? null : keys[pos]
        const key = expectKeyParity(a, b)
        expect(key).not.toBeNull()
        keys.splice(pos, 0, key as string)
      }
      // List stayed strictly sorted throughout.
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i - 1] < keys[i]).toBe(true)
      }
    }
  })

  it('matches generateNKeysBetween across open/closed ranges and counts', () => {
    const rng = makeRng(2024)
    for (let trial = 0; trial < 200; trial++) {
      // A random ordered (a, b) window inside a freshly built run.
      const run = generateNKeysBetween(null, null, 12)
      const i = randInt(rng, run.length)
      const j = randInt(rng, run.length)
      const lo = Math.min(i, j)
      const hi = Math.max(i, j)
      const n = randInt(rng, 8)

      const a = run[lo]
      const b = lo === hi ? null : run[hi]
      expect(generateNKeysBetween(a, b, n)).toEqual(oracleNKeysBetween(a, b, n))
    }
    // Edge counts and open ends.
    expect(generateNKeysBetween(null, null, 0)).toEqual(oracleNKeysBetween(null, null, 0))
    expect(generateNKeysBetween(null, null, 1)).toEqual(oracleNKeysBetween(null, null, 1))
    expect(generateNKeysBetween(null, null, 50)).toEqual(oracleNKeysBetween(null, null, 50))
    expect(generateNKeysBetween('a0', null, 25)).toEqual(oracleNKeysBetween('a0', null, 25))
    expect(generateNKeysBetween(null, 'a0', 25)).toEqual(oracleNKeysBetween(null, 'a0', 25))
  })

  it('matches across integer-length rollover on long append/prepend runs', () => {
    // A long append run forces incrementInteger to roll the integer part
    // through multiple heads and lengths (a→…→z→null path); a long prepend run
    // exercises decrementInteger symmetrically. The random test above stays in
    // head 'a'/'Z' length-2, so these cover the branchy carry/borrow code.
    const lengths = new Set<number>()
    let appendKey: string | null = null
    for (let i = 0; i < 5000; i++) {
      const mine = generateKeyBetween(appendKey, null)
      expect(mine).toBe(oracleKeyBetween(appendKey, null))
      appendKey = mine
      lengths.add(integerPartLength(mine[0]))
    }
    let prependKey: string | null = null
    for (let i = 0; i < 5000; i++) {
      const mine = generateKeyBetween(null, prependKey)
      expect(mine).toBe(oracleKeyBetween(null, prependKey))
      prependKey = mine
      lengths.add(integerPartLength(mine[0]))
    }
    // Confirm we actually crossed integer-length boundaries (not just length 2).
    expect([...lengths].some((l) => l > 2)).toBe(true)
  })

  it('matches deep same-spot inserts (long fractions)', () => {
    // Repeatedly inserting between the same two neighbors grows the fraction
    // without bound — exercises the recursive midpoint + common-prefix path.
    let lo = generateKeyBetween(null, null)
    let hi = generateKeyBetween(lo, null)
    let maxLen = 0
    for (let i = 0; i < 2000; i++) {
      const mine = generateKeyBetween(lo, hi)
      expect(mine).toBe(oracleKeyBetween(lo, hi))
      // Alternate which side we keep so the fraction deepens on both ends.
      if (i % 2 === 0) hi = mine
      else lo = mine
      maxLen = Math.max(maxLen, mine.length)
    }
    expect(maxLen).toBeGreaterThan(10)
  })

  it('throws on invalid keys and inverted bounds in both impls', () => {
    const bad: Array<[string | null, string | null]> = [
      ['a1', 'a0'], // inverted
      ['a0', 'a0'], // equal
      ['', null], // empty key
      ['a00', null], // trailing zero in fraction
      ['1', null], // invalid head
    ]
    for (const [a, b] of bad) {
      let mineThrew = false
      let theirsThrew = false
      try {
        generateKeyBetween(a, b)
      } catch {
        mineThrew = true
      }
      try {
        oracleKeyBetween(a, b)
      } catch {
        theirsThrew = true
      }
      expect(mineThrew).toBe(true)
      expect(mineThrew).toBe(theirsThrew)
    }
  })
})
