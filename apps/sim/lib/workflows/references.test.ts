import { describe, expect, it } from 'vitest'
import { isLikelyReferenceSegment, splitReferenceSegment } from '@/lib/workflows/references'

describe('splitReferenceSegment', () => {
  it('should return leading and reference for simple segments', () => {
    const result = splitReferenceSegment('<block.output>')
    expect(result).toEqual({
      leading: '',
      reference: '<block.output>',
    })
  })

  it('should separate comparator prefixes from reference', () => {
    const result = splitReferenceSegment('< <block2.output>')
    expect(result).toEqual({
      leading: '< ',
      reference: '<block2.output>',
    })
  })

  it('should handle <= comparator prefixes', () => {
    const result = splitReferenceSegment('<= <block2.output>')
    expect(result).toEqual({
      leading: '<= ',
      reference: '<block2.output>',
    })
  })
})

describe('isLikelyReferenceSegment', () => {
  it('should return true for regular references', () => {
    expect(isLikelyReferenceSegment('<block.output>')).toBe(true)
  })

  it('should return true for references after comparator', () => {
    expect(isLikelyReferenceSegment('< <block2.output>')).toBe(true)
    expect(isLikelyReferenceSegment('<= <block2.output>')).toBe(true)
  })

  it('should return false when leading content is not comparator characters', () => {
    expect(isLikelyReferenceSegment('<foo<bar>')).toBe(false)
  })
})
