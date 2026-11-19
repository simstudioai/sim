/**
 * Printing grows linearly with the workflow (see `growth` for how a case is measured).
 */
import { describe, expect, it } from 'vitest'
import { growth, MAX_GROWTH } from '../scaling.test-helpers'
import { type Doc, fill, group, indent, line, printDoc, softline } from './doc'

function numberArray(count: number): Doc {
  const parts: Doc[] = []
  for (let i = 0; i < count; i += 1) {
    if (i > 0) parts.push([',', line])
    parts.push(String(i * 7))
  }
  return group(['[', indent([softline, fill(parts)]), softline, ']'])
}

describe('print scaling', () => {
  it('fills a long number-only array in linear time', () => {
    const ratio = growth((n) => {
      const doc = numberArray(n)
      return () => printDoc(doc, 80)
    }, 5_000)
    expect(ratio).toBeLessThan(MAX_GROWTH)
  })
})
