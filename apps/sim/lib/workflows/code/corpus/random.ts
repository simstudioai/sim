/**
 * A small seeded PRNG (mulberry32) for corpus generation. A corpus built from the same seed and
 * the same registry is identical byte for byte, so a failing case id names the same workflow on
 * every machine. Not for anything security-sensitive.
 */
export interface SeededRandom {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number
  bool(): boolean
  /** One element of a non-empty array. */
  pick<T>(items: readonly [T, ...T[]] | readonly T[]): T
  /** A version-4-shaped UUID, so generated ids look like the ones the editor mints. */
  uuid(): string
}

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))

  const hex = (length: number): string => {
    let out = ''
    for (let i = 0; i < length; i++) out += int(0, 15).toString(16)
    return out
  }

  return {
    next,
    int,
    bool: () => next() < 0.5,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() needs a non-empty array')
      return items[int(0, items.length - 1)] as T
    },
    uuid: () =>
      `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + int(0, 3)).toString(16)}${hex(3)}-${hex(12)}`,
  }
}
