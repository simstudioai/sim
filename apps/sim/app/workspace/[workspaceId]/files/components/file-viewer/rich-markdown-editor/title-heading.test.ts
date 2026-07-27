/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from './editor-extensions'
import { firstHeadingTitle, titleHeadingNode } from './title-heading'

function editorWith(markdown: string): Editor {
  const editor = new Editor({ extensions: createMarkdownEditorExtensions({ placeholder: '' }) })
  if (markdown) editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor
}

describe('firstHeadingTitle', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    Element.prototype.scrollIntoView = vi.fn()
    document.elementFromPoint = vi.fn(() => null)
  })

  it('returns the leading H1 text', () => {
    const editor = editorWith('# Q3 Planning\n\nbody')
    expect(firstHeadingTitle(editor.state.doc)).toBe('Q3 Planning')
    editor.destroy()
  })

  it('returns the text of any leading heading level', () => {
    const editor = editorWith('## Sub title')
    expect(firstHeadingTitle(editor.state.doc)).toBe('Sub title')
    editor.destroy()
  })

  it('returns null when the first block is a paragraph, not a heading', () => {
    const editor = editorWith('just text\n\n# later heading')
    expect(firstHeadingTitle(editor.state.doc)).toBeNull()
    editor.destroy()
  })

  it('returns null for an empty leading heading', () => {
    const editor = editorWith('')
    editor.commands.setContent({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] })
    expect(firstHeadingTitle(editor.state.doc)).toBeNull()
    editor.destroy()
  })

  it('returns null for a whitespace-only leading heading (trim boundary)', () => {
    const editor = editorWith('')
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '   ' }] }],
    })
    expect(firstHeadingTitle(editor.state.doc)).toBeNull()
    editor.destroy()
  })
})

describe('title-heading seed (Trigger B action — always prepend, never replace)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    Element.prototype.scrollIntoView = vi.fn()
    document.elementFromPoint = vi.fn(() => null)
  })

  it('seeds an empty doc with a leading H1 (+ a body line)', () => {
    const editor = editorWith('')
    editor.commands.insertContentAt(0, titleHeadingNode('Q3 Planning'))

    expect(editor.state.doc.firstChild?.type.name).toBe('heading')
    expect(firstHeadingTitle(editor.state.doc)).toBe('Q3 Planning')
    expect(editor.getMarkdown().trim()).toBe('# Q3 Planning')
    editor.destroy()
  })

  it('prepends an H1 to existing body without a heading, keeping the body', () => {
    const editor = editorWith('some body text')
    editor.commands.insertContentAt(0, titleHeadingNode('My Notes'))

    expect(editor.state.doc.firstChild?.type.name).toBe('heading')
    expect(firstHeadingTitle(editor.state.doc)).toBe('My Notes')
    expect(editor.getMarkdown()).toContain('some body text')
    editor.destroy()
  })

  it('preserves structure-only scaffold (empty bullet list) instead of clobbering it', () => {
    // Regression: an empty bullet list carries no text, so a replace-based seed would drop it. The
    // prepend keeps it below the seeded H1.
    const editor = editorWith('')
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    })
    editor.commands.insertContentAt(0, titleHeadingNode('Kept'))

    const shape: string[] = []
    editor.state.doc.forEach((n) => shape.push(n.type.name))
    expect(shape).toEqual(['heading', 'bulletList', 'paragraph'])
    expect(firstHeadingTitle(editor.state.doc)).toBe('Kept')
    editor.destroy()
  })
})
