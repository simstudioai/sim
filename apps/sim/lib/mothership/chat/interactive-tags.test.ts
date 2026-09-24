/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { stripInteractiveTags } from '@/lib/mothership/chat/interactive-tags'

describe('stripInteractiveTags', () => {
  it('removes closed interactive tags', () => {
    expect(stripInteractiveTags('Answer <options>{"a":1}</options> end', { complete: true })).toBe(
      'Answer  end'
    )
  })
  it('keeps prose after an unclosed opener in a complete answer', () => {
    expect(stripInteractiveTags('Use <question> to ask a follow-up.', { complete: true })).toBe(
      'Use <question> to ask a follow-up.'
    )
  })
  it('withholds a tag still open at the end of a streaming answer', () => {
    expect(stripInteractiveTags('Answer <options>{"a"', { complete: false })).toBe('Answer ')
  })
})
