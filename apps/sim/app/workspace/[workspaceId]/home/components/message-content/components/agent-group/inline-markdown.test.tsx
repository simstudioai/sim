/**
 * @vitest-environment node
 */
import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown } from './inline-markdown'

function flattenText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (isValidElement<{ children?: React.ReactNode }>(node)) return flattenText(node.props.children)
  return ''
}

function findByType(parts: React.ReactNode[], type: string): React.ReactNode {
  return parts.find((p) => isValidElement(p) && p.type === type)
}

describe('renderInlineMarkdown', () => {
  it('renders **bold** spans as strong elements', () => {
    const parts = renderInlineMarkdown('The failing block is **ModalDenied** (a Slack block).')
    const bold = findByType(parts, 'strong')
    expect(bold).toBeDefined()
    expect(flattenText(bold)).toBe('ModalDenied')
    expect(flattenText(parts)).toBe('The failing block is ModalDenied (a Slack block).')
  })

  it('renders `code` spans as mono elements', () => {
    const parts = renderInlineMarkdown('check the `webhook` payload')
    expect(flattenText(findByType(parts, 'span'))).toBe('webhook')
    expect(flattenText(parts)).toBe('check the webhook payload')
  })

  it('renders *italic* spans as em elements', () => {
    const parts = renderInlineMarkdown('this is *important* context')
    expect(flattenText(findByType(parts, 'em'))).toBe('important')
  })

  it('renders ***bold-italic*** as nested strong and em', () => {
    const parts = renderInlineMarkdown('a ***wrapped*** word')
    const bold = findByType(parts, 'strong')
    expect(bold).toBeDefined()
    expect(flattenText(parts)).toBe('a wrapped word')
  })

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

  it('renders nested markers inside emphasis and link labels', () => {
    expect(
      flattenText(renderInlineMarkdown('read [**the docs**](https://sim.ai/docs) first'))
    ).toBe('read the docs first')
    expect(flattenText(renderInlineMarkdown('use *`glob`* patterns'))).toBe('use glob patterns')
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

  it('passes plain text through untouched', () => {
    expect(renderInlineMarkdown('no markup here.')).toEqual(['no markup here.'])
  })
})
