/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '../editor-extensions'

// jsdom lacks elementFromPoint, which TipTap's Placeholder viewport tracking calls on mount.
beforeAll(() => {
  document.elementFromPoint = vi.fn(() => null)
})

let editor: Editor | null = null

function editorWith(content: string, embeds = true): Editor {
  editor = new Editor({
    extensions: createMarkdownEditorExtensions({ placeholder: '', embeds }),
    content,
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

const YOUTUBE_LINK = '<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">watch</a></p>'

describe('LinkEmbed', () => {
  it('renders a player beneath a standalone embeddable link', () => {
    const view = editorWith(YOUTUBE_LINK).view
    const iframe = view.dom.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })

  it('renders one player per link when the same URL appears twice', () => {
    const view = editorWith(`${YOUTUBE_LINK}${YOUTUBE_LINK}`).view
    expect(view.dom.querySelectorAll('iframe')).toHaveLength(2)
  })

  it('keeps the underlying document a plain markdown link (lossless round-trip)', () => {
    const markdown = editorWith(YOUTUBE_LINK).getMarkdown()
    expect(markdown).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(markdown).not.toContain('<iframe')
  })

  it('does not embed an inline link inside surrounding text', () => {
    const view = editorWith(
      '<p>see <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">here</a> now</p>'
    ).view
    expect(view.dom.querySelector('iframe')).toBeNull()
  })

  it('does not embed a non-embeddable standalone link', () => {
    const view = editorWith('<p><a href="https://example.com/article">read</a></p>').view
    expect(view.dom.querySelector('iframe')).toBeNull()
  })

  it('does nothing when the embeds option is disabled', () => {
    const view = editorWith(YOUTUBE_LINK, false).view
    expect(view.dom.querySelector('iframe')).toBeNull()
  })
})
