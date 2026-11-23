import { describe, expect, it } from 'vitest'
import { markdownCell, summaryMarker } from './source-ui'

describe('summaryMarker', () => {
  it('gives directories whose names differ only in punctuation different markers', () => {
    expect(summaryMarker('a-b')).not.toBe(summaryMarker('a--b'))
    expect(summaryMarker('a b')).not.toBe(summaryMarker('a-b'))
  })

  it('never carries a double hyphen, which would end the comment', () => {
    expect(summaryMarker('a--b>c')).not.toContain('--b')
    expect(summaryMarker('a--b>c')).toMatch(/^<!-- sim-plan:[A-Za-z0-9._/%]+ -->$/)
  })
})

describe('markdownCell', () => {
  it('escapes a backslash before a pipe, so an already-escaped pipe cannot reopen the cell', () => {
    expect(markdownCell('foo\\|bar')).toBe('foo\\\\\\|bar')
  })
})
