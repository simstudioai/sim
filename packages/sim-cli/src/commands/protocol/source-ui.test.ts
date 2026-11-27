import { describe, expect, it } from 'vitest'
import { codeSpan, markdownCell, summaryMarker } from './source-ui'

describe('summaryMarker', () => {
  it('gives directories whose names differ only in punctuation different markers', () => {
    expect(summaryMarker('a-b')).not.toBe(summaryMarker('a--b'))
    expect(summaryMarker('a b')).not.toBe(summaryMarker('a-b'))
  })

  it('gives directories whose names differ only past the Basic Multilingual Plane different markers', () => {
    expect(summaryMarker('ws-😀')).not.toBe(summaryMarker('ws-🚀'))
    expect(summaryMarker('ws-😀')).toBe('<!-- sim-plan:ws%2D%F0%9F%98%80 -->')
  })

  it('encodes a name inside the Basic Multilingual Plane byte by byte', () => {
    expect(summaryMarker('café 数据')).toBe('<!-- sim-plan:caf%C3%A9%20%E6%95%B0%E6%8D%AE -->')
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

describe('codeSpan', () => {
  it('leaves a plain command in single backticks', () => {
    expect(codeSpan('sim get --dir ./a')).toBe('`sim get --dir ./a`')
  })

  it('fences a command containing backticks with more of them, on one line', () => {
    expect(codeSpan('sim get --dir a`b\nc')).toBe('`` sim get --dir a`b c ``')
  })
})
