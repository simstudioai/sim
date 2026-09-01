/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from './editor-extensions'
import { firstHeadingTitle } from './title-heading'

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
