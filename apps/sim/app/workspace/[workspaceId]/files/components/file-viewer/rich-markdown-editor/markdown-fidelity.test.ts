import { describe, expect, it } from 'vitest'
import { postProcessSerializedMarkdown } from './markdown-fidelity'

describe('postProcessSerializedMarkdown — empty list-item stripping', () => {
  it('drops a nested empty bullet that would re-parse as a Setext heading', () => {
    // `- one\n  - ` re-parses as `- ## one` (the `  - ` acts as a Setext underline). Stripping the
    // empty bullet on serialize keeps the parent a bullet and makes the round-trip stable.
    expect(postProcessSerializedMarkdown('- one\n  - \n\n')).toBe('- one\n')
  })

  it('drops a nested empty ordered item', () => {
    expect(postProcessSerializedMarkdown('1. one\n   2. \n')).toBe('1. one\n')
  })

  it('preserves a top-level empty bullet (placeholder / imported blank — round-trips faithfully)', () => {
    // A top-level empty item is not Setext-hazardous and round-trips as an empty item, so it must be
    // kept: it may be a placeholder row the user is about to fill, or an intentionally-blank imported item.
    expect(postProcessSerializedMarkdown('- one\n- \n')).toBe('- one\n- \n')
    expect(postProcessSerializedMarkdown('- one\n- \n- three\n')).toBe('- one\n- \n- three\n')
    expect(postProcessSerializedMarkdown('1. one\n2. \n')).toBe('1. one\n2. \n')
  })

  it('keeps bullets that have content', () => {
    expect(postProcessSerializedMarkdown('- a\n- b\n')).toBe('- a\n- b\n')
    expect(postProcessSerializedMarkdown('- a\n  - b\n')).toBe('- a\n  - b\n')
  })

  it('keeps a nested empty parent whose next line is an indented child (no orphaning)', () => {
    expect(postProcessSerializedMarkdown('- top\n  - \n    - child\n')).toBe(
      '- top\n  - \n    - child\n'
    )
  })

  it('keeps a thematic break and empty checklist items (not Setext-hazardous)', () => {
    expect(postProcessSerializedMarkdown('text\n\n---\n\nmore\n')).toBe('text\n\n---\n\nmore\n')
    expect(postProcessSerializedMarkdown('- [ ] a\n- [ ] \n')).toBe('- [ ] a\n- [ ] \n')
  })

  it('leaves marker-only lines inside a fenced code block untouched', () => {
    const code = '```\n- \n-\n1. \n```\n'
    expect(postProcessSerializedMarkdown(code)).toBe(code)
  })

  it('leaves marker-only lines inside a tilde (~~~) fence untouched', () => {
    const code = '~~~\n- \n1. \n~~~\n'
    expect(postProcessSerializedMarkdown(code)).toBe(code)
  })

  it('does not strip inside an unterminated fence (fence stays open to EOF)', () => {
    // A fence with no closing delimiter must keep every interior line, including marker-only ones.
    const code = '```\n- \n-\n'
    expect(postProcessSerializedMarkdown(code)).toBe(code)
  })
})
