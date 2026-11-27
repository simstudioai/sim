/**
 * The index atop `cookbook.ts` names a line of each example by number, which an edit above that
 * line moves without any compile noticing: each entry's line must still hold the name it gives.
 */
import { escapeRegExp } from '@sim/utils/string'
import { describe, expect, it } from 'vitest'
import { COOKBOOK_EXAMPLES } from './cookbook-text.generated'

describe('the cookbook index', () => {
  it('points every entry at a code line holding the name it gives', () => {
    const index = COOKBOOK_EXAMPLES['cookbook.ts'] ?? ''
    const entries = [...index.matchAll(/^\/\/ {3}(\S+\.ts):(\d+) ([^:\s]+):/gm)]
    expect(entries.length).toBeGreaterThan(10)
    const misses = entries.flatMap(([entry, file, line, name]) => {
      const text = COOKBOOK_EXAMPLES[file]?.split('\n')[Number(line) - 1] ?? ''
      // The name as code: called or keyed (`fn(`, `tools: [`), not inside another word.
      const asCode = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?=[(:])`)
      return asCode.test(text) && !text.trimStart().startsWith('//') ? [] : [entry]
    })
    expect(misses).toEqual([])
  })
})
