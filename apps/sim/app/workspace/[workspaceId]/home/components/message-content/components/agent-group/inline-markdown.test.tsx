/**
 * @vitest-environment node
 */
import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown } from './inline-markdown'

function textOfPart(part: React.ReactNode): string {
  if (typeof part === 'string') return part
  if (isValidElement<{ children?: React.ReactNode }>(part)) return String(part.props.children)
  return ''
}

describe('renderInlineMarkdown', () => {
  it('renders **bold** spans as strong elements', () => {
    const parts = renderInlineMarkdown('The failing block is **ModalDenied** (a Slack block).')
    const bold = parts.find((p) => isValidElement(p) && p.type === 'strong')
    expect(bold).toBeDefined()
    expect(textOfPart(bold)).toBe('ModalDenied')
    expect(parts.some((p) => typeof p === 'string' && p.includes('*'))).toBe(false)
  })

  it('renders `code` spans as mono elements', () => {
    const parts = renderInlineMarkdown('check the `webhook` payload')
    const code = parts.find((p) => isValidElement(p) && p.type === 'span')
    expect(textOfPart(code)).toBe('webhook')
  })

  it('leaves unterminated markers verbatim', () => {
    expect(renderInlineMarkdown('a **dangling marker')).toEqual(['a **dangling marker'])
    expect(renderInlineMarkdown('a `dangling tick')).toEqual(['a `dangling tick'])
  })

  it('passes plain text through untouched', () => {
    expect(renderInlineMarkdown('no markup here.')).toEqual(['no markup here.'])
  })

  it('renders *italic* spans as em elements', () => {
    const parts = renderInlineMarkdown('this is *important* context')
    const em = parts.find((p) => isValidElement(p) && p.type === 'em')
    expect(textOfPart(em)).toBe('important')
  })

  it('does not italicize bare asterisks in math-like text', () => {
    expect(renderInlineMarkdown('2 * 3 * 4')).toEqual(['2 * 3 * 4'])
  })

  it('renders links as their label text', () => {
    const parts = renderInlineMarkdown('see [the docs](https://sim.ai/docs) for more')
    expect(parts.join('')).toBe('see the docs for more')
  })
})
