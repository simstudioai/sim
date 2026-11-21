import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, it } from 'vitest'
import type { CanonicalBlock } from '../model'
import { settingsIndex } from './settings-index'

/** `n` function blocks sharing a language, each with its own code, so none settles a match. */
function functionBlocks(
  n: number,
  prefix: string
): Array<[string, Pick<CanonicalBlock, 'params'>]> {
  return Array.from({ length: n }, (_, i) => [
    `${prefix}${i}`,
    {
      params: {
        language: { kind: 'value', value: 'javascript' },
        code: { kind: 'value', value: `return '${prefix}${i}'` },
      },
    },
  ])
}

describe('settingsIndex', () => {
  it('looks up blocks that all hold the narrowing param, each with its own value, in linear time', () => {
    expectLinearGrowth((n) => {
      const indexed = functionBlocks(n, 'old')
      const lookups = functionBlocks(n, 'new')
      return () => {
        const matches = settingsIndex(indexed)
        for (const [, block] of lookups) Array.from(matches(block))
      }
    }, 250)
  })
})
