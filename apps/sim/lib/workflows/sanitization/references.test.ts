import { describe, expect, it } from 'vitest'
import {
  containsReference,
  isLikelyReferenceSegment,
  splitOutsideReferences,
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

describe('splitOutsideReferences', () => {
  it('splits on separator commas', () => {
    expect(splitOutsideReferences('kb_a,kb_b')).toEqual(['kb_a', 'kb_b'])
  })

  it('trims entries and drops empties', () => {
    expect(splitOutsideReferences(' kb_a , , kb_b ')).toEqual(['kb_a', 'kb_b'])
  })

  it('keeps a comma that sits inside a workflow reference', () => {
    expect(splitOutsideReferences('<start.pick(a,b)>')).toEqual(['<start.pick(a,b)>'])
  })

  it('keeps a comma inside a reference while still splitting around it', () => {
    expect(splitOutsideReferences('kb_a,<start.pick(x,y)>,kb_b')).toEqual([
      'kb_a',
      '<start.pick(x,y)>',
      'kb_b',
    ])
  })

  it('keeps a comma inside an env-var placeholder', () => {
    expect(splitOutsideReferences('{{A,B}},kb_a')).toEqual(['{{A,B}}', 'kb_a'])
  })

  it('returns a single entry when there is no separator', () => {
    expect(splitOutsideReferences('kb_a')).toEqual(['kb_a'])
  })

  it('stays linear on a large value instead of rescanning tokens per comma', () => {
    // A per-comma `tokens.some()` is O(commas x tokens) and took ~2.5s on this input.
    const value = '{{A}},'.repeat(40000)
    const startedAt = performance.now()
    const parts = splitOutsideReferences(value)
    const elapsedMs = performance.now() - startedAt

    expect(parts).toHaveLength(40000)
    expect(elapsedMs).toBeLessThan(1000)
  })

  it('does not yet protect a comma inside a reference that nests an env-var placeholder', () => {
    // Known limitation, unchanged from the plain `.split(',')` this replaced: the tokenizer
    // reports the inner `{{A}}` and suppresses the outer `<...>` span, so the comma reads as a
    // separator. Characterized rather than fixed - the suppression lives in the shared
    // `@sim/utils/workflow-references` tokenizer.
    expect(splitOutsideReferences('<start.body.pick({{A}},b)>,kb_literal')).toEqual([
      '<start.body.pick({{A}}',
      'b)>',
      'kb_literal',
    ])
  })
})
