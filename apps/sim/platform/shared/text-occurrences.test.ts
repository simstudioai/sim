import { describe, expect, it } from 'vitest'
import { locateOccurrences, type TextPiece } from '@/platform/shared/text-occurrences'

/** Pieces for consecutive nodes joined by `separator`, as the chat's text walk assembles them. */
function assemble(nodes: string[], separator = '') {
  const pieces: TextPiece[] = []
  let text = ''
  for (const node of nodes) {
    if (pieces.length) text += separator
    pieces.push({ start: text.length, skip: 0, length: node.length })
    text += node
  }
  return { text, pieces }
}

describe('locateOccurrences', () => {
  it('spans a match across inline formatting, ignoring case', () => {
    const { text, pieces } = assemble(['Hello ', 'wor', 'ld'])
    expect(locateOccurrences(text, pieces, 'WORLD', 10)).toEqual([
      { first: 1, startOffset: 0, last: 2, endOffset: 2 },
    ])
  })

  it('skips an occurrence that starts in the separator between blocks', () => {
    const { text, pieces } = assemble(['end', 'next'], '\n')
    expect(locateOccurrences(text, pieces, ' next', 10)).toEqual([])
    expect(locateOccurrences(text, pieces, 'next', 10)).toEqual([
      { first: 1, startOffset: 0, last: 1, endOffset: 4 },
    ])
  })

  it('offsets into a node past the characters it leaves out', () => {
    const text = 'first\nline'
    const pieces = [
      { start: 0, skip: 0, length: 5 },
      { start: 6, skip: 1, length: 4 },
    ]
    expect(locateOccurrences(text, pieces, 'line', 10)).toEqual([
      { first: 1, startOffset: 1, last: 1, endOffset: 5 },
    ])
  })

  it('keeps only the first occurrences up to the limit', () => {
    const { text, pieces } = assemble(['ab ab ab'])
    expect(locateOccurrences(text, pieces, 'ab', 2)).toEqual([
      { first: 0, startOffset: 0, last: 0, endOffset: 2 },
      { first: 0, startOffset: 3, last: 0, endOffset: 5 },
    ])
  })
})
