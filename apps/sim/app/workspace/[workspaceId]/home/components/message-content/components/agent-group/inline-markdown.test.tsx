import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown } from './inline-markdown'

function flattenText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (isValidElement<{ children?: React.ReactNode }>(node)) return flattenText(node.props.children)
  return ''
}

describe('renderInlineMarkdown', () => {
  it('renders links as their label text', () => {
    const parts = renderInlineMarkdown('see [the docs](https://sim.ai/docs) for more')
    expect(flattenText(parts)).toBe('see the docs for more')
  })

  it('keeps emphasis markers inside code spans verbatim', () => {
    const parts = renderInlineMarkdown('pass `*args` and `**kwargs` through')
    const codeTexts = parts
      .filter((p) => isValidElement(p) && p.type === 'span')
      .map((p) => flattenText(p))
    expect(codeTexts).toEqual(['*args', '**kwargs'])
    expect(flattenText(parts)).toBe('pass *args and **kwargs through')
  })

  it('leaves unterminated markers verbatim', () => {
    expect(renderInlineMarkdown('a **dangling marker')).toEqual(['a **dangling marker'])
    expect(renderInlineMarkdown('a `dangling tick')).toEqual(['a `dangling tick'])
  })

  it('does not italicize bare asterisks in math-like text', () => {
    expect(renderInlineMarkdown('2 * 3 * 4')).toEqual(['2 * 3 * 4'])
  })

  it('never reclassifies plain text the tokenizer rejected', () => {
    expect(renderInlineMarkdown('* x *')).toEqual(['* x *'])
    expect(renderInlineMarkdown('** spaced bullets **')).toEqual(['** spaced bullets **'])
  })
})
