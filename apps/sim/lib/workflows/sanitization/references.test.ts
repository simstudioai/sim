import { describe, expect, it } from 'vitest'
import {
  containsReference,
  isLikelyReferenceSegment,
  splitReferenceSegment,
} from '@/lib/workflows/sanitization/references'

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

  it('should return true for references starting with a digit', () => {
    expect(isLikelyReferenceSegment('<1password1>')).toBe(true)
    expect(isLikelyReferenceSegment('<1password1.secret>')).toBe(true)
  })

  it('should return false for purely numeric references', () => {
    expect(isLikelyReferenceSegment('<123>')).toBe(false)
  })
})

describe('containsReference', () => {
  it('detects block and variable references', () => {
    expect(containsReference('<start.input>')).toBe(true)
    expect(containsReference('<variable.model>')).toBe(true)
    expect(containsReference('<loop.index>')).toBe(true)
  })

  it('detects environment variable placeholders', () => {
    expect(containsReference('{{MODEL_ID}}')).toBe(true)
  })

  it('detects a reference embedded in surrounding text', () => {
    expect(containsReference('gpt-<start.suffix>')).toBe(true)
  })

  it('returns false for literal model ids', () => {
    expect(containsReference('gpt-5.1')).toBe(false)
    expect(containsReference('claude-sonnet-5')).toBe(false)
    expect(containsReference('azure/gpt-5.1-codex')).toBe(false)
  })

  it('returns false for empty and non-string values', () => {
    expect(containsReference('')).toBe(false)
    expect(containsReference(undefined)).toBe(false)
    expect(containsReference(null)).toBe(false)
    expect(containsReference(42)).toBe(false)
  })

  it('returns false for stray brackets that are not references', () => {
    expect(containsReference('a < b')).toBe(false)
    expect(containsReference('<123>')).toBe(false)
    expect(containsReference('value <limit && value>max')).toBe(false)
    expect(containsReference('a<b<c>d')).toBe(false)
  })
})
