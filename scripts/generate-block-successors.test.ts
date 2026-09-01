import { describe, expect, it } from 'vitest'
import { flattenSuccessors } from './generate-block-successors'

const registered = (blocks: readonly string[]) => (blockType: string) => blocks.includes(blockType)

describe('flattenSuccessors', () => {
  it('follows a chain to the current version so one lookup answers it', () => {
    const map = flattenSuccessors({ a: 'b', b: 'c' }, registered(['a', 'b', 'c']))

    expect(map.get('a')).toBe('c')
    expect(map.get('b')).toBe('c')
  })

  it('stops rather than looping when successors point at each other', () => {
    const map = flattenSuccessors({ a: 'b', b: 'a' }, registered(['a', 'b']))

    expect(map.get('a')).toBe('b')
    expect(map.get('b')).toBe('a')
  })

  /**
   * A `replacedBy` naming a block that was never registered — a typo, or a
   * successor removed later — must leave the retired id as its own answer. The
   * editor still offers it as an allowlist row under that id, so resolving it to
   * a type nothing can be permitted as would deny it with no row to fix it.
   */
  it('keeps its own identity when the named successor is not registered', () => {
    const map = flattenSuccessors({ a: 'gone' }, registered(['a']))

    expect(map.has('a')).toBe(false)
  })

  it('emits nothing for a block that is already current', () => {
    expect(flattenSuccessors({}, registered(['slack_v2'])).size).toBe(0)
  })

  /** No key may also be a value, or the runtime's single lookup would be short. */
  it('produces a closed map', () => {
    const map = flattenSuccessors({ a: 'b', b: 'c' }, registered(['a', 'b', 'c']))

    for (const successor of map.values()) expect(map.has(successor)).toBe(false)
  })
})
